import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUnifiedFireRescuePlan, type PlanAuditEvent, type UnifiedFireRescuePlan } from './plan-contract';

type PersistedPlanStore = {
  schemaVersion: 1;
  plans: UnifiedFireRescuePlan[];
};

export class PlanConflictError extends Error {
  constructor(message = '预案已被其他操作更新，请刷新后重试。') {
    super(message);
    this.name = 'PlanConflictError';
  }
}

export class PlanStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PlanStorageError';
  }
}

export type PlanListFilters = {
  incidentId?: string;
  sceneId?: string;
  floor?: string;
  planId?: string;
  version?: number;
  createdFrom?: string;
  createdTo?: string;
};

function matchesListFilters(plan: UnifiedFireRescuePlan, building: string | undefined, filters: PlanListFilters) {
  if (building && plan.building.name !== building) return false;
  if (filters.incidentId && plan.event.incidentId !== filters.incidentId) return false;
  if (filters.sceneId && plan.spatialTarget.sceneId !== filters.sceneId) return false;
  if (filters.floor && plan.spatialTarget.floor !== filters.floor) return false;
  if (filters.planId && plan.planId !== filters.planId) return false;
  if (typeof filters.version === 'number' && plan.version !== filters.version) return false;
  // createdAt 为 ISO 字符串，按字典序比较即等价于时间序。
  if (filters.createdFrom && plan.createdAt < filters.createdFrom) return false;
  if (filters.createdTo && plan.createdAt > filters.createdTo) return false;
  return true;
}

function removeTargetTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const container = value as Record<string, unknown>;
  const target = container.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) delete (target as Record<string, unknown>).tree;
  removeTargetTree(container.data);
  removeTargetTree(container.spatial);
}

function copy(value: UnifiedFireRescuePlan): UnifiedFireRescuePlan {
  const plan = structuredClone(value);
  for (const invocation of plan.orchestration) {
    removeTargetTree(invocation.output);
    removeTargetTree(invocation.input);
  }
  return plan;
}

function defaultStoragePath() {
  const configured = process.env.FIRE_PLAN_STORAGE_PATH?.trim();
  return configured || path.join(process.cwd(), '.data', 'fire-rescue-plans.json');
}

function validStore(value: unknown): value is PersistedPlanStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const store = value as { schemaVersion?: unknown; plans?: unknown };
  return store.schemaVersion === 1 && Array.isArray(store.plans) && store.plans.every(isUnifiedFireRescuePlan);
}

/** File-backed store with atomic replacement. It is intentionally fail-closed on corruption. */
export class FilePlanRepository {
  private readonly plans = new Map<string, UnifiedFireRescuePlan>();
  private initialized = false;
  private writeQueue = Promise.resolve();

  constructor(private readonly storagePath = defaultStoragePath()) {}

  get filePath() {
    return this.storagePath;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      const content = await readFile(this.storagePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (!validStore(parsed)) throw new PlanStorageError('预案持久化文件结构无效，拒绝覆盖现有审计数据。');
      for (const plan of parsed.plans) this.plans.set(plan.planId, copy(plan));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        // The first plan will create the file using the same atomic write path.
      } else if (error instanceof PlanStorageError) {
        throw error;
      } else {
        throw new PlanStorageError('无法读取预案持久化文件，未使用空仓库继续运行。', error);
      }
    }
    this.initialized = true;
  }

  private async persist() {
    const directory = path.dirname(this.storagePath);
    const payload = JSON.stringify({ schemaVersion: 1, plans: [...this.plans.values()] satisfies UnifiedFireRescuePlan[] }, null, 2);
    const temporary = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, payload, 'utf8');
      await rename(temporary, this.storagePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw new PlanStorageError('预案持久化写入失败，当前操作未确认成功。', error);
    }
  }

  private async queueWrite(action: () => void) {
    const queued = this.writeQueue.then(async () => {
      const before = new Map([...this.plans.entries()].map(([id, plan]) => [id, copy(plan)]));
      try {
        action();
        await this.persist();
      } catch (error) {
        this.plans.clear();
        for (const [id, plan] of before) this.plans.set(id, plan);
        throw error;
      }
    });
    this.writeQueue = queued.catch(() => undefined);
    await queued;
  }

  async append(plan: UnifiedFireRescuePlan) {
    await this.initialize();
    const saved = copy(plan);
    await this.queueWrite(() => {
      if (this.plans.has(saved.planId)) throw new PlanConflictError('预案编号已存在，未覆盖历史版本。');
      this.plans.set(saved.planId, copy(saved));
    });
    return copy(saved);
  }

  async get(planId: string) {
    await this.initialize();
    const plan = this.plans.get(planId);
    return plan ? copy(plan) : undefined;
  }

  // 需求书 12.3：归档记录需支持按事件编号、建筑、场景、楼层、时间、预案编号和版本检索。
  // 保留 (building, limit) 位置参数，避免既有调用方（lib/skills/server.ts）改动。
  async list(building?: string, limit = 5, filters: PlanListFilters = {}) {
    await this.initialize();
    return [...this.plans.values()]
      .filter((plan) => matchesListFilters(plan, building, filters))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit))
      .map(copy);
  }

  async latest(incidentId: string) {
    await this.initialize();
    return [...this.plans.values()]
      .filter((plan) => plan.event.incidentId === incidentId)
      .sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt))
      .at(-1)
      ? copy([...this.plans.values()]
        .filter((plan) => plan.event.incidentId === incidentId)
        .sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt))
        .at(-1)!)
      : undefined;
  }

  async update(planId: string, expectedRevision: number, mutate: (plan: UnifiedFireRescuePlan) => UnifiedFireRescuePlan) {
    await this.initialize();
    let updated: UnifiedFireRescuePlan | undefined;
    await this.queueWrite(() => {
      const current = this.plans.get(planId);
      if (!current) throw new PlanStorageError('未找到指定预案。');
      if (current.revision !== expectedRevision) throw new PlanConflictError();
      const next = mutate(copy(current));
      if (next.planId !== planId) throw new PlanStorageError('预案更新不得改变预案编号。');
      if (next.revision !== current.revision + 1) throw new PlanStorageError('预案更新必须递增 revision。');
      if (!isUnifiedFireRescuePlan(next)) throw new PlanStorageError('预案更新后不符合统一契约。');
      this.plans.set(planId, copy(next));
      updated = next;
    });
    return copy(updated!);
  }
}

/**
 * 构造审计事件。
 *
 * meta 承载需求书 §16 要求的 actorType / revision / source / requestId。
 * 可选而非必填：历史调用点不带这四项，缺失时按未记录显示，不回填伪造值。
 * revision 必须由调用方传入更新后的版本号——审计事件此时还没落库，
 * 拿不到最终 revision，写错比不写更糟。
 */
export function auditEvent(
  type: PlanAuditEvent['type'],
  actor: string,
  detail: string,
  evidenceRefs: string[] = [],
  meta: Pick<PlanAuditEvent, 'actorType' | 'revision' | 'source' | 'requestId'> = {},
): PlanAuditEvent {
  return { eventId: randomUUID(), type, at: new Date().toISOString(), actor, detail, evidenceRefs, ...meta };
}

/** The command application owns one process-wide repository instance. */
const runtimeRepository = new FilePlanRepository();

export function getPlanRepository() {
  return runtimeRepository;
}
