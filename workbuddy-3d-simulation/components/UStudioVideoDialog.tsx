'use client';

import { useEffect, useRef, useState } from 'react';
import {
  normalizeUStudioVideoPayload,
  USTUDIO_VIDEO_OPEN_EVENT,
  type UStudioVideoPayload,
} from '@/lib/video-runtime';

type MpegtsPlayer = {
  attachMediaElement(video: HTMLVideoElement): void;
  load(): void;
  unload?: () => void;
  detachMediaElement?: () => void;
  destroy(): void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type MpegtsModule = {
  isSupported?: () => boolean;
  getFeatureList?: () => {
    mseFlvPlayback?: boolean;
    mseLiveFlvPlayback?: boolean;
    mseLivePlayback?: boolean;
  };
  createPlayer(source: { type: 'flv'; url: string; isLive?: boolean; cors?: boolean }, config?: Record<string, unknown>): MpegtsPlayer;
  Events?: { ERROR?: string };
};

type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

type HlsModule = {
  new(config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
};

type VideoKind = 'flv' | 'hls' | 'native';

function detectVideoKind(url: string): VideoKind {
  const lower = url.toLowerCase();
  if (lower.includes('.flv') || lower.includes('format=flv') || lower.includes('type=flv')) return 'flv';
  if (lower.includes('.m3u8') || lower.includes('format=m3u8') || lower.includes('type=m3u8')) return 'hls';
  return 'native';
}

function videoErrorText(video: HTMLVideoElement | null): string {
  const code = video?.error?.code;
  if (code === MediaError.MEDIA_ERR_ABORTED) return '视频播放已中断';
  if (code === MediaError.MEDIA_ERR_NETWORK) return '视频网络加载失败';
  if (code === MediaError.MEDIA_ERR_DECODE) return '视频解码失败，请检查编码格式';
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return '当前视频地址或格式不支持播放';
  return '视频播放失败，请检查地址或编码格式';
}

export function UStudioVideoDialog() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mpegtsRef = useRef<MpegtsPlayer | null>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const [payload, setPayload] = useState<UStudioVideoPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cleanupPlayers = () => {
    mpegtsRef.current?.unload?.();
    mpegtsRef.current?.detachMediaElement?.();
    mpegtsRef.current?.destroy();
    mpegtsRef.current = null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  };

  useEffect(() => {
    const onOpen = (event: Event) => {
      try {
        setError('');
        setPayload(normalizeUStudioVideoPayload((event as CustomEvent).detail));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPayload(null);
      }
    };
    window.addEventListener(USTUDIO_VIDEO_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(USTUDIO_VIDEO_OPEN_EVENT, onOpen);
      cleanupPlayers();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!payload || !video) return;
    const currentPayload = payload;
    const currentVideo = video;

    let disposed = false;
    cleanupPlayers();
    setLoading(true);
    setError('');
    video.controls = true;
    video.autoplay = true;
    video.muted = true;
    video.loop = false;
    video.playsInline = true;

    async function start() {
      const kind = detectVideoKind(currentPayload.url);
      try {
        if (kind === 'flv') {
          const imported = await import('mpegts.js');
          if (disposed) return;
          const mpegts = (imported.default ?? imported) as unknown as MpegtsModule;
          const feature = mpegts.getFeatureList?.();
          const supported = mpegts.isSupported?.() ??
            feature?.mseLiveFlvPlayback ??
            feature?.mseFlvPlayback ??
            feature?.mseLivePlayback ??
            false;
          if (!supported) throw new Error('当前浏览器不支持 FLV 播放');
          const player = mpegts.createPlayer(
            { type: 'flv', url: currentPayload.url, isLive: true, cors: true },
            { enableWorker: true, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true },
          );
          const errorEvent = mpegts.Events?.ERROR ?? 'error';
          player.on?.(errorEvent, (_type, detail) => {
            if (!disposed) setError('FLV 播放失败' + (detail ? ': ' + String(detail) : ''));
          });
          mpegtsRef.current = player;
          player.attachMediaElement(currentVideo);
          player.load();
        } else if (kind === 'hls' && !currentVideo.canPlayType('application/vnd.apple.mpegurl')) {
          const imported = await import('hls.js');
          if (disposed) return;
          const Hls = (imported.default ?? imported) as unknown as HlsModule;
          if (!Hls.isSupported()) throw new Error('当前浏览器不支持 HLS 播放');
          const hls = new Hls({ enableWorker: true });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
            if (!disposed && record.fatal) setError('HLS 播放失败');
          });
          hlsRef.current = hls;
          hls.loadSource(currentPayload.url);
          hls.attachMedia(currentVideo);
        } else {
          currentVideo.src = currentPayload.url;
          currentVideo.load();
        }

        await currentVideo.play().catch(() => {
          if (!disposed) setError('浏览器阻止自动播放，请手动点击播放');
        });
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void start();
    return () => {
      disposed = true;
    };
  }, [payload]);

  if (!payload && !error) return null;

  const close = () => {
    cleanupPlayers();
    setPayload(null);
    setError('');
    setLoading(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="视频播放"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(2, 6, 23, 0.58)',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        style={{
          width: 'min(960px, calc(100vw - 48px))',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.28)',
          background: '#0f172a',
          color: '#e5e7eb',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.48)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>视频播放</div>
            {payload?.url && (
              <div style={{ marginTop: 4, maxWidth: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 12 }}>
                {payload.url}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: 'rgba(15, 23, 42, 0.8)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>
        <div style={{ position: 'relative', background: '#020617', aspectRatio: '16 / 9' }}>
          {payload && (
            <video
              ref={videoRef}
              controls
              muted
              playsInline
              onPlaying={() => {
                setLoading(false);
                setError('');
              }}
              onCanPlay={() => setLoading(false)}
              onWaiting={() => setLoading(true)}
              onError={() => {
                setLoading(false);
                setError(videoErrorText(videoRef.current));
              }}
              style={{ width: '100%', height: '100%', display: 'block', background: '#020617' }}
            />
          )}
          {loading && !error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cbd5e1', fontSize: 14, pointerEvents: 'none' }}>
              正在加载视频...
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, color: '#fecaca', fontSize: 14, textAlign: 'center', background: 'rgba(2, 6, 23, 0.72)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
