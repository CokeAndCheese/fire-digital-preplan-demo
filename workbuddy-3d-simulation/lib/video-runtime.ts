'use client';

export type UStudioVideoPayload = {
  url: string;
};

export type UStudioVideoResult = {
  opened: true;
  url: string;
};

export const USTUDIO_VIDEO_OPEN_EVENT = 'ustudio:video:open';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(key: unknown): string {
  return String(key ?? '').toLowerCase().replace(/[\s_\-]/g, '');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractUrl(value: unknown, depth = 0): string {
  if (depth > 5) return '';
  const direct = stringValue(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item) && normalizeKey(item.key) === 'url') {
        const fromKeyValue = extractUrl(item.value, depth + 1);
        if (fromKeyValue) return fromKeyValue;
      }
      const nested = extractUrl(item, depth + 1);
      if (nested) return nested;
    }
    return '';
  }

  if (!isRecord(value)) return '';
  for (const key of ['url', 'src', 'videoUrl', 'video_url', 'flvUrl', 'flv_url', 'hlsUrl', 'hls_url', 'playUrl', 'play_url']) {
    const fromField = extractUrl(value[key], depth + 1);
    if (fromField) return fromField;
  }

  for (const key of ['params', 'payload', 'data']) {
    const nested = extractUrl(value[key], depth + 1);
    if (nested) return nested;
  }

  return extractUrl(value.input_params ?? value.inputParams, depth + 1);
}

export function normalizeUStudioVideoPayload(params?: unknown): UStudioVideoPayload {
  const url = extractUrl(params);
  if (!url) throw new Error('视频地址不能为空');
  return { url };
}

export function showUStudioVideo(params?: unknown): UStudioVideoResult {
  const payload = normalizeUStudioVideoPayload(params);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<UStudioVideoPayload>(USTUDIO_VIDEO_OPEN_EVENT, { detail: payload }));
  }
  return { opened: true, url: payload.url };
}
