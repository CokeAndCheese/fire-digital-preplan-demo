'use client';

import { useEffect, useRef, useState } from 'react';
import type { EmptySceneBootstrap, SceneBootstrap, SceneBootstrapResponse } from '@/lib/ustudio';
import type { SceneVisualCommand } from '@/lib/scene-command-bridge';
import { createDefaultPlugins, localStoragePersistence, PluginManager } from '@/lib/scene-plugins';
import { sceneSdk } from '@/lib/scene-sdk';
import { SoonspaceRuntime } from '@/lib/soonspace-runtime';
import { withBasePath } from '@/lib/client-path';
import type { RuntimeConfig } from '@/lib/app-key';
import { i18n } from '@/lib/i18n';
import { PluginPanel } from './PluginPanel';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type LoadStage = 'setup' | 'loading';

async function fetchJson<T>(url: string, logContext: Record<string, unknown> = {}): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    if (response.ok && isJson) return (await response.json()) as T;

    const text = await response.text().catch(() => '');
    const looksLikeHtml = /^\s*</.test(text);
    if (looksLikeHtml && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      continue;
    }

    if (isJson) {
      const payload = JSON.parse(text || '{}') as {
        message?: string;
        upstreamUrl?: string;
        upstreamMethod?: string;
        upstreamParams?: unknown;
        [key: string]: unknown;
      };
      const originalUrl = typeof payload.upstreamUrl === 'string' && payload.upstreamUrl ? payload.upstreamUrl : url;
      console.error('[soonspace-viewer] fetch failed', {
        url: originalUrl,
        nextUrl: url,
        method: payload.upstreamMethod ?? 'GET',
        params: payload.upstreamParams ?? logContext.params,
        status: response.status,
        statusText: response.statusText,
        contentType,
        response: payload,
      });
      throw new Error(payload.message ?? '请求失败: ' + originalUrl);
    }
    const summary = looksLikeHtml ? '接口返回了 HTML 页面，可能是预览正在编译或接口异常' : text.slice(0, 180);
    console.error('[soonspace-viewer] fetch failed', {
      url,
      method: 'GET',
      status: response.status,
      statusText: response.statusText,
      contentType,
      response: summary,
      ...logContext,
    });
    throw new Error(summary + ': ' + url);
  }
  throw new Error('请求失败: ' + url);
}

function isEmptySceneBootstrap(bootstrap: SceneBootstrapResponse): bootstrap is EmptySceneBootstrap {
  return (bootstrap as EmptySceneBootstrap).empty === true;
}

const SELECTED_SCENE_STORAGE_PREFIX = 'jarvis:ustudio:selected-scene:';
const DEFAULT_SCENE_ID = process.env.NEXT_PUBLIC_DEFAULT_SCENE_ID?.trim() || '477747327523254272';

function sceneSelectionScope(): string {
  const envScope = process.env.NEXT_PUBLIC_JARVIS_WORKSPACE_ID?.trim();
  if (envScope) return envScope;
  if (typeof window === 'undefined') return 'default';
  return window.location.origin + window.location.pathname;
}

function selectedSceneStorageKey(): string {
  return SELECTED_SCENE_STORAGE_PREFIX + sceneSelectionScope();
}

function sceneIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const sceneId = new URLSearchParams(window.location.search).get('sceneId')?.trim();
  return sceneId || null;
}

function shouldResetSceneSelection(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sceneReset') === 'config-change';
}

function readStoredSelectedSceneId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(selectedSceneStorageKey())?.trim() || null;
  } catch {
    return null;
  }
}

function updateSceneIdInLocation(sceneId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (sceneId) url.searchParams.set('sceneId', sceneId);
    else url.searchParams.delete('sceneId');
    url.searchParams.delete('sceneReset');
    window.history.replaceState(null, '', url);
  } catch {
    // ignore readonly history
  }
}

function rememberSelectedSceneId(sceneId: string): void {
  if (!sceneId.trim() || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(selectedSceneStorageKey(), sceneId);
  } catch {
    // ignore storage quota/privacy errors
  }
  updateSceneIdInLocation(sceneId);
}

function clearSelectedSceneId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(selectedSceneStorageKey());
  } catch {
    // ignore storage quota/privacy errors
  }
  updateSceneIdInLocation(null);
}

function initialSelectedSceneId(): string | null {
  if (shouldResetSceneSelection()) {
    clearSelectedSceneId();
    return null;
  }
  return sceneIdFromLocation() ?? readStoredSelectedSceneId() ?? DEFAULT_SCENE_ID;
}

export function SoonspaceSceneViewer({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [message, setMessage] = useState(() => i18n('viewer.loading.initial'));
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState<LoadStage>('setup');
  const [pluginManager, setPluginManager] = useState<PluginManager | null>(null);
  const [scenes, setScenes] = useState<SceneBootstrap['scenes']>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(() => initialSelectedSceneId());
  const [currentSceneId, setCurrentSceneId] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [activeVisualCommand, setActiveVisualCommand] = useState<SceneVisualCommand | null>(null);
  const highlightedCommandObjectRef = useRef('');
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    document.getElementById('jarvis-preview-fallback')?.remove();
  }, []);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    let disposed = false;
    let runtime: SoonspaceRuntime | null = null;
    let manager: PluginManager | null = null;

    async function run() {
      const container = containerRef.current;
      if (!container) return;
      const stale = () => disposed || generation !== loadGenerationRef.current;
      setState('loading');
      setMessage(i18n('viewer.loading.bootstrap'));
      setLoadProgress(2);
      setLoadStage('setup');
      setPluginManager(null);
      setShowPanel(false);
      container.replaceChildren();

      const qs = selectedSceneId ? '?sceneId=' + encodeURIComponent(selectedSceneId) : '';
      const bootstrapUrl = withBasePath('/api/ustudio/bootstrap') + qs;
      const bootstrapParams = { sceneId: selectedSceneId || undefined };
      console.info('[soonspace-viewer] request bootstrap', { url: bootstrapUrl, method: 'GET', params: bootstrapParams });
      const bootstrap = await fetchJson<SceneBootstrapResponse>(bootstrapUrl, { params: bootstrapParams });
      if (isEmptySceneBootstrap(bootstrap)) {
        console.info('[soonspace-viewer] bootstrap empty', {
          sceneCount: bootstrap.sceneCount,
          message: bootstrap.message,
        });
        if (stale()) return;
        setScenes(bootstrap.scenes ?? []);
        setCurrentSceneId('');
        clearSelectedSceneId();
        setState('empty');
        setMessage(i18n('viewer.empty.scenes'));
        setLoadProgress(0);
        setLoadStage('setup');
        return;
      }
      console.info('[soonspace-viewer] bootstrap response', {
        sceneId: bootstrap.scene.scene_id,
        sceneName: bootstrap.scene.scene_name,
        sceneCount: bootstrap.sceneCount,
      });
      if (stale()) return;

      setScenes(bootstrap.scenes ?? []);
      setCurrentSceneId(bootstrap.scene.scene_id);
      rememberSelectedSceneId(bootstrap.scene.scene_id);
      setMessage(i18n('viewer.loading.soonspace'));
      setLoadProgress(5);
      setLoadStage('setup');

      runtime = new SoonspaceRuntime();
      await runtime.init(container, bootstrap.scene.scene_id, runtimeConfig, (progress) => {
        if (stale()) return;
        if (progress.stage !== 'ready') setLoadStage(progress.stage);
        setMessage(progress.message || i18n('viewer.loading.soonspace'));
        if (typeof progress.percent === 'number') setLoadProgress(Math.max(5, Math.min(100, progress.percent)));
      });
      if (stale()) {
        await runtime.dispose();
        return;
      }

      manager = new PluginManager({
        viewer: runtime.getPluginHost(),
        persistence: localStoragePersistence(bootstrap.scene.scene_id),
        resources: {
          runtime,
          sceneId: bootstrap.scene.scene_id,
        },
      });
      for (const plugin of createDefaultPlugins()) {
        await manager.register(plugin);
      }
      if (stale()) {
        manager.disposeAll();
        await runtime.dispose();
        return;
      }

      setPluginManager(manager);
      setState('ready');
      setLoadProgress(100);
      setMessage(i18n('viewer.loading.done'));
    }

    run().catch((error) => {
      if (!disposed) {
        setState('error');
        setMessage(error instanceof Error ? error.message : '场景加载失败');
      }
    });

    return () => {
      disposed = true;
      manager?.disposeAll();
      void runtime?.dispose();
      setPluginManager(null);
    };
  }, [selectedSceneId]);

  useEffect(() => {
    if (state !== 'ready' || !currentSceneId) return;
    let disposed = false;
    let timer: number | undefined;

    const acknowledge = async (commandId: string, ok: boolean, message: string) => {
      await fetch(withBasePath('/v1/scene-commands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId, ok, message, executedAt: new Date().toISOString() }),
      }).catch(() => undefined);
    };

    const display = async (command: SceneVisualCommand) => {
      if (command.sceneId !== currentSceneId) {
        await acknowledge(command.commandId, false, 'Command scene does not match the active 3D model.');
        return;
      }
      try {
        const sdk = sceneSdk();
        const priorObjectId = highlightedCommandObjectRef.current;
        if (priorObjectId && priorObjectId !== command.target.objectId) {
          sdk.cancelHeighLight?.(priorObjectId);
        }
        sdk.fly(command.target.objectId);
        sdk.heighLight(command.target.objectId, '#ff4c4c');
        // 定位到"楼层"时，隔离显示该着火楼层，让镜头明确聚焦到这一层；
        // 定位到具体房间则只高亮，不隔离楼层。
        if (command.target.kind === 'floor') {
          try {
            // setScene({ stories:[该楼层对象], mode:'3D' }) 只显示该楼层，
            // 使 7F 这类着火楼层成为清晰焦点，而不是停留整个楼栋的广角。
            await sdk.setScene({ stories: [command.target.objectId], mode: '3D' });
          } catch {
            // 楼层隔离失败不影响定位与高亮，忽略即可。
          }
        }
        // 在着火位置画醒目的火点标记（红色十字/小圆环），避免"只看到楼层、看不到着火点"。
        const fp = command.incident?.firePoint;
        if (fp && typeof sdk.drawRoute === 'function') {
          try {
            const pts = [
              [fp.x - 2, fp.y, fp.z], [fp.x + 2, fp.y, fp.z],
              [fp.x, fp.y - 2, fp.z], [fp.x, fp.y + 2, fp.z],
            ];
            const flat = pts.flat();
            sdk.drawRoute(flat, `fire-point-${command.commandId}`, { route_color: '#ff2d2d', route_name: '着火位置', userData: { width: 2 } });
          } catch {
            // 绘制火点标记失败不影响定位与高亮。
          }
        }
        highlightedCommandObjectRef.current = command.target.objectId;
        setActiveVisualCommand(command);
        await acknowledge(command.commandId, true, `3D model focused and highlighted ${command.target.label}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : '3D model SDK is not ready.';
        await acknowledge(command.commandId, false, message);
      }
    };

    const poll = async () => {
      try {
        const response = await fetch(withBasePath(`/v1/scene-commands?sceneId=${encodeURIComponent(currentSceneId)}`), { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json() as { commands?: SceneVisualCommand[] };
          for (const command of payload.commands ?? []) await display(command);
        }
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), 350);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [currentSceneId, state]);

  const showProgress = state !== 'empty' && state !== 'error';

  return (
    <main className="viewerShell">
      <div ref={containerRef} className="viewerCanvas" />
      <div className="viewerBrand" aria-label="三维消防指挥台">
        <span>FIRE COMMAND / 3D</span>
        <strong>三维消防指挥台</strong>
        <small>五矿国际广场 · 实时场景</small>
      </div>
      {activeVisualCommand && (
        <aside className="sceneCommandOverlay" aria-live="polite" aria-label="实时警情定位">
          <span>实时警情定位</span>
          <strong>{activeVisualCommand.target.label}</strong>
          <p>
            {activeVisualCommand.incident.floor && `${activeVisualCommand.incident.floor} `}
            {activeVisualCommand.incident.room && `${activeVisualCommand.incident.room} `}
            {activeVisualCommand.incident.trappedCount !== undefined && `被困 ${activeVisualCommand.incident.trappedCount} 人`}
          </p>
        </aside>
      )}
      <div className={'topRight ' + (state !== 'ready' ? 'disabled' : '')}>
        {scenes.length > 0 && (
          <select
            className="sceneSelect"
            value={currentSceneId}
            disabled={state === 'loading'}
            onChange={(e) => {
              const nextSceneId = e.target.value;
              rememberSelectedSceneId(nextSceneId);
              setSelectedSceneId(nextSceneId);
            }}
          >
            {scenes.map((s) => (
              <option key={s.scene_id} value={s.scene_id}>
                {s.scene_name || s.scene_id}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={'pluginToggle' + (showPanel ? ' on' : '')}
          disabled={state !== 'ready' || !pluginManager}
          onClick={() => setShowPanel((v) => !v)}
          aria-pressed={showPanel}
          title={i18n('viewer.plugin.title')}
        >
          {i18n('viewer.plugin.button')}
        </button>
      </div>
      {pluginManager && showPanel && state === 'ready' && <PluginPanel manager={pluginManager} />}
      {state !== 'ready' && (
        <div className={'status ' + state}>
          <div className="statusTitle">{message}</div>
          {showProgress && (
            <>
              <div className="statusMeta">
                <span>
                  {loadStage === 'loading'
                    ? i18n('viewer.stage.loading')
                    : i18n('viewer.stage.setup')}
                </span>
                <span>{Math.max(0, Math.min(100, loadProgress)) + '%'}</span>
              </div>
              <div className="statusProgress" aria-hidden>
                <span style={{ width: Math.max(0, Math.min(100, loadProgress)) + '%' }} />
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
