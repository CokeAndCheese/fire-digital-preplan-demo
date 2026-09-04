export type SkillId = 'scene-control' | 'response-level' | 'fire-resource' | 'route-water' | 'plan-template' | 'rescue-plan' | 'competition-orchestrator' | 'fire-zone-deploy';

export type SkillRole = 'core' | 'orchestration';

export type SkillAction = {
  id: string;
  name: string;
  description: string;
  requiresApproval: boolean;
  inputExample: Record<string, unknown>;
};

export type SkillDefinition = {
  id: SkillId;
  packageName: string;
  name: string;
  shortName: string;
  description: string;
  targetProject: string;
  role: SkillRole;
  order: number;
  inputs: string[];
  output: string;
  endpointEnv: 'SCENE_CONTROL_URL' | 'RESPONSE_LEVEL_URL' | 'FIRE_RESOURCE_PLATFORM_URL' | 'RESCUE_PLAN_URL' | 'COMPETITION_ORCHESTRATOR_URL' | 'PLAN_TEMPLATE_KB_URL';
  actions: SkillAction[];
};

export type SkillStatus = 'online' | 'standby' | 'offline';

export type SkillRuntime = SkillDefinition & {
  status: SkillStatus;
  latencyMs?: number;
  mode: 'bridge' | 'platform' | 'simulation';
  checkedAt: string;
};

export type SkillExecutionRequest = {
  skillId: SkillId;
  actionId: string;
  input?: Record<string, unknown>;
  approved?: boolean;
  taskId?: string;
};

export type SkillExecutionResult = {
  executionId: string;
  skillId: SkillId;
  actionId: string;
  ok: boolean;
  mode: 'bridge' | 'platform' | 'simulation';
  startedAt: string;
  finishedAt: string;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
};
