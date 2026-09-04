'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelShell } from '@/components/PanelShell';
import { sceneSdk } from '@/lib/scene-sdk';
import type { SceneTreeNode } from '@/lib/ustudio';
import {
  generateRescuePlan,
  riskBadgeClass,
  riskLevelText,
  signPlan,
  type FireRescuePlan,
  type FireSituation,
} from '@/lib/fire-rescue-plan';
import { withBasePath } from '@/lib/client-path';

type TreeApiNode = {
  id: string;
  name: string;
  type: string;
  children?: TreeApiNode[];
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function collectNodes(root: TreeApiNode | null): TreeApiNode[] {
  if (!root) return [];
  const result: TreeApiNode[] = [];
  function walk(node: TreeApiNode) {
    result.push(node);
    node.children?.forEach(walk);
  }
  walk(root);
  return result;
}

function isSpaceType(type: string): boolean {
  return /space|room|area/i.test(type);
}

function isStoryType(type: string): boolean {
  return /story|floor/i.test(type);
}

function floorsFromTree(root: TreeApiNode | null): TreeApiNode[] {
  if (!root) return [];
  const result: TreeApiNode[] = [];
  function walk(node: TreeApiNode) {
    if (isStoryType(node.type) && (node.children ?? []).length > 0) {
      result.push(node);
    }
    node.children?.forEach(walk);
  }
  walk(root);
  return result.sort(naturalCompareByName);
}

function naturalCompareByName(a: TreeApiNode, b: TreeApiNode): number {
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

export function FireRescuePlanPanel() {
  const [tree, setTree] = useState<TreeApiNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  const [floorId, setFloorId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [fireLocation, setFireLocation] = useState('');
  const [trappedCount, setTrappedCount] = useState<number | ''>('');
  const [burnArea, setBurnArea] = useState<number | ''>('');

  const [plan, setPlan] = useState<FireRescuePlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const playbackTimer = useRef<number | null>(null);
  const highlightedRoomId = useRef<string>('');

  const nodes = useMemo(() => collectNodes(tree), [tree]);
  const floors = useMemo(() => nodes.filter((n) => isStoryType(n.type) && n.children && n.children.length > 0), [nodes]);
  const floorNode = useMemo(() => floors.find((n) => n.id === floorId) ?? null, [floors, floorId]);
  const rooms = useMemo(() => {
    if (!floorNode) return [];
    return (floorNode.children ?? [])
      .filter((n) => isSpaceType(n.type))
      .sort(naturalCompareByName);
  }, [floorNode]);

  const selectedFloor = floorNode;
  const selectedRoom = rooms.find((n) => n.id === roomId);

  const loadTree = async ({ invalidate = false } = {}) => {
    setLoadingTree(true);
    setTreeError('');
    try {
      // 必须显式带上当前场景 scene_id，否则服务端会兜底到 bootstrap 里的「当前场景」，
      // 在 Jarvis 预览/切换场景后可能与实际场景不一致。
      const sceneId = window.__sceneId ?? '';
      const query = new URLSearchParams();
      query.set('t', String(Date.now()));
      if (sceneId) query.set('sceneId', sceneId);
      const res = await fetch(withBasePath(`/api/ustudio/tree?${query.toString()}`));
      if (!res.ok) throw new Error((await res.json()).message || '加载场景树失败');
      const data: TreeApiNode = await res.json();
      setTree(data);
      setLastUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        const allFloors = floorsFromTree(data);
        const firstFloor = allFloors[0];
        if (firstFloor) {
          setFloorId((prev) => {
            const stillExists = prev && allFloors.some((f) => f.id === prev);
            return stillExists ? prev : firstFloor.id;
          });
          setRoomId((prev) => {
            const nextFloorId = allFloors.some((f) => f.id === floorId) ? floorId : firstFloor.id;
            const nextRooms = (allFloors.find((f) => f.id === nextFloorId)?.children ?? [])
              .filter((n) => isSpaceType(n.type))
              .sort(naturalCompareByName);
            const stillExists = prev && nextRooms.some((r) => r.id === prev);
            return stillExists ? prev : (nextRooms[0]?.id ?? '');
          });
        } else {
        setFloorId('');
        setRoomId('');
      }
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTree(false);
    }
  };

  useEffect(() => {
    loadTree();
  }, []);

  useEffect(() => {
    return () => {
      if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
    };
  }, []);

  const applyRoomHighlight = (nextRoomId: string) => {
    try {
      const sdk = sceneSdk();
      if (highlightedRoomId.current && highlightedRoomId.current !== nextRoomId) {
        sdk.cancelHeighLight?.(highlightedRoomId.current);
      }
      if (nextRoomId) {
        sdk.fly(nextRoomId);
        sdk.heighLight(nextRoomId, '#ff4c4c');
      }
      highlightedRoomId.current = nextRoomId;
    } catch {
      // SDK 未就绪时忽略 3D 联动
    }
  };

  const clearRoomHighlight = () => {
    try {
      const sdk = sceneSdk();
      if (highlightedRoomId.current) {
        sdk.cancelHeighLight?.(highlightedRoomId.current);
        highlightedRoomId.current = '';
      }
    } catch {
      // ignore
    }
  };

  const handleGenerate = () => {
    if (!selectedFloor || !selectedRoom) return;
    setGenerating(true);
    setPlaybackIndex(-1);
    const situation: FireSituation = {
      floorId: selectedFloor.id,
      floorName: selectedFloor.name,
      roomId: selectedRoom.id,
      roomName: selectedRoom.name,
      fireLocation: fireLocation.trim() || selectedRoom.name,
      trappedCount: typeof trappedCount === 'number' ? trappedCount : 0,
      burnArea: typeof burnArea === 'number' ? burnArea : 0,
    };
    // 模拟秒级生成
    window.setTimeout(() => {
      setPlan(generateRescuePlan(situation));
      setGenerating(false);
      applyRoomHighlight(selectedRoom.id);
    }, 600);
  };

  const handleSign = () => {
    if (!plan) return;
    setPlan(signPlan(plan));
  };

  const handlePlayback = () => {
    if (!plan) return;
    if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
    setPlaybackIndex(0);
    applyRoomHighlight(plan.situation.roomId);
    let step = 0;
    const run = () => {
      step += 1;
      if (step >= plan.timeline.length) {
        setPlaybackIndex(-1);
        return;
      }
      setPlaybackIndex(step);
      playbackTimer.current = window.setTimeout(run, 1500);
    };
    playbackTimer.current = window.setTimeout(run, 1500);
  };

  const handleClearScene = () => {
    if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
    setPlaybackIndex(-1);
    clearRoomHighlight();
    try {
      const sdk = sceneSdk();
      if (highlightedRoomId.current) sdk.cancelHeighLight?.(highlightedRoomId.current);
    } catch {
      // ignore
    }
  };

  const isReady = selectedFloor && selectedRoom;
  const playbackActive = playbackIndex >= 0;

  return (
    <div id="panel-fire-rescue-plan">
      <PanelShell
        name="fire-rescue-plan"
        title="灭火救援预案生成"
        description="选择楼层房间并录入起火位置、被困人数、燃烧面积，秒级生成可签发的灭火救援预案，支持 3D 推演。"
        width={400}
      >
        <div className="frp-section">
          <div className="frp-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>目标位置</span>
            <button
              type="button"
              className="frp-btn frp-btn-secondary frp-btn-small"
              onClick={() => loadTree({ invalidate: true })}
              disabled={loadingTree}
              title="从 uTwin 刷新楼层与房间数据"
            >
              {loadingTree ? '刷新中…' : '刷新'}
            </button>
          </div>
          {loadingTree && <div className="frp-hint">正在加载空间数据…</div>}
          {treeError && <div className="frp-error">{treeError}</div>}
          <div className="frp-row">
            <div className="frp-field">
              <label>楼层</label>
              <select
                value={floorId}
                onChange={(e) => {
                  setFloorId(e.target.value);
                  setRoomId('');
                }}
                disabled={loadingTree || floors.length === 0}
              >
                <option value="">请选择楼层</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || f.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="frp-field">
            <label>起火房间 / 空间</label>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={loadingTree || rooms.length === 0}>
              <option value="">请选择房间/空间</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.id}
                </option>
              ))}
            </select>
            {floorId && rooms.length === 0 && !loadingTree && <div className="frp-hint">该楼层暂无房间数据</div>}
            {lastUpdatedAt && !loadingTree && <div className="frp-hint">更新时间 {lastUpdatedAt}</div>}
          </div>
        </div>

        <div className="frp-section">
          <div className="frp-section-title">现场态势</div>
          <div className="frp-field">
            <label>起火位置描述</label>
            <textarea
              value={fireLocation}
              onChange={(e) => setFireLocation(e.target.value)}
              placeholder="例如：301会议室西南角电气柜"
            />
          </div>
          <div className="frp-row">
            <div className="frp-field">
              <label>被困人数</label>
              <div className="frp-number">
                <input
                  type="number"
                  min={0}
                  value={trappedCount}
                  onChange={(e) => setTrappedCount(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <span>人</span>
              </div>
            </div>
            <div className="frp-field">
              <label>燃烧面积</label>
              <div className="frp-number">
                <input
                  type="number"
                  min={0}
                  value={burnArea}
                  onChange={(e) => setBurnArea(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <span>㎡</span>
              </div>
            </div>
          </div>
        </div>

        <div className="frp-actions">
          <button type="button" className="frp-btn frp-btn-secondary" onClick={() => { setPlan(null); setRoomId(''); handleClearScene(); }}>
            重置
          </button>
          <button type="button" className="frp-btn frp-btn-primary" onClick={handleGenerate} disabled={!isReady || generating}>
            {generating ? '生成中…' : '生成预案'}
          </button>
        </div>

        {plan && (
          <div className="frp-plan">
            <h3>{plan.title}</h3>
            <div className="frp-plan-item">
              <strong>危险等级</strong>
              <span className={`frp-badge ${riskBadgeClass(plan.riskLevel)}`}>{riskLevelText(plan.riskLevel)}</span>
            </div>
            <div className="frp-plan-item">
              <strong>力量部署</strong>
              <span>{plan.deployments.map((d) => `${d.count} 组${d.name}（${d.task}）`).join('、')}</span>
            </div>
            <div className="frp-plan-item">
              <strong>灭火策略</strong>
              <span>{plan.fireStrategy}</span>
            </div>
            <div className="frp-plan-item">
              <strong>优先级</strong>
              <span>{plan.priorities.map((p, i) => `${i + 1}. ${p}`).join('  ')}</span>
            </div>

            <div className="frp-timeline">
              {plan.timeline.map((step, idx) => (
                <div key={idx} className={`frp-timeline-step ${playbackActive && idx === playbackIndex ? 'active' : ''}`}>
                  <div className="frp-timeline-dot" />
                  <div className="frp-timeline-text">T+{step.minute} {step.action}</div>
                </div>
              ))}
            </div>

            <div className="frp-status-bar">
              <span>生成时间 {formatTime(plan.createdAt)}</span>
              {plan.signedAt ? (
                <span className={`frp-badge frp-badge-signed`}>已签发 · {plan.signedBy}</span>
              ) : (
                <button type="button" className="frp-btn frp-btn-primary frp-btn-small" onClick={handleSign}>
                  签发预案
                </button>
              )}
            </div>
          </div>
        )}

        <div className="frp-section" style={{ marginTop: 12 }}>
          <div className="frp-section-title">3D 推演</div>
          <div className="frp-actions">
            <button type="button" className="frp-btn frp-btn-secondary" onClick={handlePlayback} disabled={!plan || playbackActive}>
              {playbackActive ? '推演中…' : '逐步推演'}
            </button>
          </div>
          <p className="frp-hint">点击“逐步推演”按时间轴在三维模型中定位并高亮起火位置。</p>
        </div>
      </PanelShell>
    </div>
  );
}
