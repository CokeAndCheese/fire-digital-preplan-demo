import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || '';

if (basePath && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
  throw new Error('NEXT_PUBLIC_BASE_PATH 必须为空，或以 / 开头且不以 / 结尾。');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  poweredByHeader: false,
  output: 'standalone',
  turbopack: {
    root: path.resolve(projectDirectory, '..'),
  },
};

export default nextConfig;
