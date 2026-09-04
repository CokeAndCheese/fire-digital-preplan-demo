/**
 * Build-time path prefix for browser requests owned by this Next application.
 *
 * Next.js applies `basePath` automatically to `next/link` and static assets,
 * but it cannot rewrite strings passed to `fetch` or third-party SDKs. Keep
 * those local paths in one place so the application works both at `/` and
 * under a mounted path such as `/fire-digital-preplan-demo/scene`.
 */
export function normalizeBasePath(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw || raw === '/') return '';
  if (!raw.startsWith('/')) {
    throw new Error(`NEXT_PUBLIC_BASE_PATH must start with '/': ${value}`);
  }
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
    throw new Error(`NEXT_PUBLIC_BASE_PATH must be a URL pathname: ${value}`);
  }

  const normalized = raw.replace(/\/+$/, '');
  if (!normalized || normalized === '/') return '';
  if (normalized.includes('//')) {
    throw new Error(`NEXT_PUBLIC_BASE_PATH must not contain empty path segments: ${value}`);
  }
  return normalized;
}

/** The same build-time value that is passed to Next's `basePath` config. */
export const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/**
 * Prefix an application-owned browser pathname with the configured base path.
 * Absolute external URLs and protocol-relative URLs are returned unchanged so
 * a gateway URL can never accidentally be routed through the local app.
 */
export function withBasePath(path: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return path;
  if (!path.startsWith('/')) {
    throw new Error(`Local browser path must start with '/': ${path}`);
  }
  return `${basePath}${path}`;
}

