/** @type {import('next').NextConfig} */

function normalizeBasePath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
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

const nextConfig = {
  output: 'standalone',
  basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH),
  transpilePackages: [
    'ustudio-sdk',
    'soonspacejs',
    '@soonspacejs/plugin-cps-soonmanager',
    '@soonspacejs/plugin-atmosphere',
    '@soonspacejs/plugin-effect',
    '@soonspacejs/plugin-fds',
    '@soonspacejs/plugin-flow',
    '@soonspacejs/plugin-gs3d-loader',
    '@soonspacejs/plugin-poi-renderer',
    '@soonspacejs/plugin-tiles',
  ],
};

export default nextConfig;
