import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeConfig } from '../app-key';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getRuntimeConfig', () => {
  it('prefers private runtime values over legacy public variables', () => {
    vi.stubEnv('X_APP_KEY', ' private-key ');
    vi.stubEnv('NEXT_PUBLIC_X_APP_KEY', 'legacy-key');
    vi.stubEnv('USTUDIO_GATEWAY', 'https://private.example///');
    vi.stubEnv('NEXT_PUBLIC_USTUDIO_BASE', 'https://public.example');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'https://ws.example');
    vi.stubEnv('NEXT_PUBLIC_LOCALE', 'en');

    expect(getRuntimeConfig()).toEqual({
      appKey: 'private-key',
      hostUrl: 'https://private.example',
      locale: 'en-US',
    });
  });

  it('keeps compatibility fallbacks and safe defaults', () => {
    vi.stubEnv('NEXT_PUBLIC_X_APP_KEY', 'legacy-key');
    vi.stubEnv('NEXT_PUBLIC_USTUDIO_BASE', 'https://public.example/');

    expect(getRuntimeConfig()).toEqual({
      appKey: 'legacy-key',
      hostUrl: 'https://public.example',
      locale: 'zh-CN',
    });
  });
});
