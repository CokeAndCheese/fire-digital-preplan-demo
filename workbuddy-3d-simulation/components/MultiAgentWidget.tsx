'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RuntimeConfig } from '@/lib/app-key';
import { useSceneId } from '@/lib/useSceneId';
import { withBasePath } from '@/lib/client-path';

/* ── 内联 SVG ── */

function IconMultiAgent({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* 天线 */}
      <path d="M12 5V2.5" />
      <circle cx="12" cy="1.9" r="1.15" fill="currentColor" stroke="none" />
      {/* 头 */}
      <rect x="3.5" y="5" width="17" height="14" rx="4.5" />
      {/* 耳朵 */}
      <path d="M3.5 10.5H2v3.5h1.5" />
      <path d="M20.5 10.5H22v3.5h-1.5" />
      {/* 眼睛 */}
      <circle cx="9" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
      {/* 微笑 */}
      <path d="M9 15.2c1 .9 2 1.2 3 1.2s2-.3 3-1.2" />
    </svg>
  );
}

function IconX({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

function IconLoader({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`ma-spin ${className ?? ''}`} aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/* ── 常量 ── */

const BTN_SIZE = 48;
const MIN_PANEL_W = 360;

/* ── 动态加载 SDK ── */

type MultiAgentSDKModule = typeof import('@dt-uagent/multi-agent-sdk');

let sdkModulePromise: Promise<MultiAgentSDKModule> | null = null;

function loadSDK(): Promise<MultiAgentSDKModule> {
  if (sdkModulePromise) return sdkModulePromise;
  sdkModulePromise = import('@dt-uagent/multi-agent-sdk');
  return sdkModulePromise;
}

/* ── 组件 ── */

export function MultiAgentWidget({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  const sceneId = useSceneId();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sdkReady, setSdkReady] = useState(false);
  const [panelW, setPanelW] = useState(() => {
    if (typeof window !== 'undefined') {
      return Math.max(MIN_PANEL_W, Math.round((window.innerHeight - 32) * 3 / 4));
    }
    return 620; // SSR fallback
  });

  const maxPanelW = Math.max(MIN_PANEL_W, size.w - 200);

  // 窗口缩小时 clamp panelW（size 未初始化时跳过，避免误钳）
  useEffect(() => {
    if (size.w > 0 && panelW > maxPanelW) setPanelW(maxPanelW);
  }, [maxPanelW, panelW, size.w]);

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);
  const instanceRef = useRef<{ sendMessage: (content: string, forwardedProps?: Record<string, string>) => void; destroy: () => void } | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sdkModuleRef = useRef<MultiAgentSDKModule | null>(null);
  const sceneIdRef = useRef<string>(sceneId);
  sceneIdRef.current = sceneId;

  /* ── 视口 ── */
  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  /* ── 位置 ── */
  const maxX = Math.max(8, size.w - BTN_SIZE - 8);
  const maxY = Math.max(8, size.h - BTN_SIZE - 8);

  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    prevOpenRef.current = open;
    setPos((prev) => {
      if (!prev) return { x: size.w - BTN_SIZE - 24, y: size.h - BTN_SIZE - 100 };
      const x = Math.min(Math.max(prev.x, 8), maxX);
      const y = Math.min(Math.max(prev.y, 8), maxY);
      return x === prev.x && y === prev.y ? prev : { x, y };
    });
  }, [size.w, size.h, maxX, maxY]);

  /* ── 面板定位：跟随按钮 ── */
  const panelStyle: React.CSSProperties = { width: panelW };
  if (pos) {
    const leftOfBtn = pos.x - panelW - 8;
    const rightOfBtn = pos.x + BTN_SIZE + 8;
    if (leftOfBtn >= 8) {
      panelStyle.left = leftOfBtn;
    } else if (rightOfBtn + panelW <= size.w - 8) {
      panelStyle.left = rightOfBtn;
    } else {
      panelStyle.left = 8;
    }
    panelStyle.top = 8;
  }

  /* ── SDK 初始化 ── */
  useEffect(() => {
    const sdk = sdkModuleRef.current;
    const container = mountRef.current;
    if (!open || !sdkReady || !sdk || !container) return;
    const sid = sceneIdRef.current;
    instanceRef.current = sdk.init(
      {
        apiBaseUrl: withBasePath('/uagent-service'),
        appKey: runtimeConfig.appKey,
        forwardedProps: sid ? { scene_id: sid } : {},
        locale: runtimeConfig.locale,
      },
      { container, themeMode: 'dark' },
    );
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [open, sdkReady, sceneId, runtimeConfig]);

  /* ── 开关面板 ── */
  const handleToggle = useCallback(async () => {
    if (!open) {
      setOpen(true);
      setLoading(true);
      try {
        sdkModuleRef.current = await loadSDK();
        setLoading(false);
        setSdkReady(true);
      } catch {
        setLoading(false);
        setOpen(false);
      }
    } else {
      instanceRef.current?.destroy();
      instanceRef.current = null;
      sdkModuleRef.current = null;
      setSdkReady(false);
      setOpen(false);
    }
  }, [open]);

  /* ── 面板宽度拖拽 ── */
  const onResizeDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: panelW };
    e.stopPropagation();
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    const st = resizeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dx = st.startX - e.clientX; // 正值=向左拖=变宽
    setPanelW(Math.min(Math.max(st.startW + dx, MIN_PANEL_W), maxPanelW));
  };
  const onResizeUp = (e: ReactPointerEvent) => {
    const st = resizeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  /* ── 拖拽 ── */
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.moved && Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 4) return;
    if (!st.moved) { st.moved = true; setDragging(true); }
    setPos({ x: Math.min(Math.max(e.clientX - st.offsetX, 8), maxX), y: Math.min(Math.max(e.clientY - st.offsetY, 8), maxY) });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const wasDrag = st.moved;
    dragRef.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (!wasDrag) void handleToggle();
  };

  return (
    <>
      {pos && sceneId && (
        <button type="button" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          className={`ma-fab${dragging ? ' ma-fab--dragging' : ''}`}
          style={{ left: pos.x, top: pos.y, width: BTN_SIZE, height: BTN_SIZE }}
          aria-label="多智能体" title="多智能体">
          <IconMultiAgent size={26} className="ma-fab-icon" />
        </button>
      )}

      {open && (
        <div className="ma-panel" style={panelStyle}>
          <div className="ma-resize-handle"
            onPointerDown={onResizeDown} onPointerMove={onResizeMove}
            onPointerUp={onResizeUp} onPointerCancel={onResizeUp}
          />
          <div className="ma-panel-head">
            <span className="ma-panel-title">多智能体</span>
            <button type="button" className="ma-icon-btn" onClick={handleToggle} aria-label="关闭">
              <IconX size={16} />
            </button>
          </div>
          <div className="ma-panel-body">
            {loading ? (
              <div className="ma-loading"><IconLoader size={28} /><span>加载中...</span></div>
            ) : (
              <div className="ma-sdk-mount" ref={mountRef} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
