/**
 * Credentials and gateway settings are read by the server at runtime.
 * Do not export a value constant from this module: importing such a constant
 * from a client component lets Next.js replace it during the client build.
 */
export type RuntimeConfig = {
  appKey: string;
  hostUrl: string;
  locale: 'zh-CN' | 'en-US';
};

const DEFAULT_USTUDIO_GATEWAY = 'https://fc.xwbuilders.com';

function normalizedUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Read the standalone process environment, with private variables taking
 * precedence over the legacy public names kept for compatibility.
 */
export function getRuntimeConfig(): RuntimeConfig {
  // Keep legacy NEXT_PUBLIC_* compatibility as a dynamic lookup. Direct
  // property access would be frozen by Next at build time even on the server.
  const runtimeEnv = process.env;
  const appKey = runtimeEnv.X_APP_KEY?.trim() || runtimeEnv.NEXT_PUBLIC_X_APP_KEY?.trim() || '';
  const hostUrl = normalizedUrl(
    runtimeEnv.USTUDIO_GATEWAY ||
      runtimeEnv.NEXT_PUBLIC_USTUDIO_BASE ||
      runtimeEnv.NEXT_PUBLIC_WS_URL ||
      DEFAULT_USTUDIO_GATEWAY,
  );
  const locale = runtimeEnv.NEXT_PUBLIC_LOCALE === 'en' ? 'en-US' : 'zh-CN';
  return { appKey, hostUrl, locale };
}

/** Server-only convenience for the UStudio service wrapper. */
export function getServerAppKey(): string {
  return getRuntimeConfig().appKey;
}
