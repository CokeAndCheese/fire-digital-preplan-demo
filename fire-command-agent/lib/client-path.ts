/**
 * Build a URL for an API owned by this Next.js application.
 *
 * Next.js applies `basePath` automatically to Link/router URLs, but browser
 * fetch URLs are plain URLs and need the prefix explicitly.
 */
export function clientPath(pathname: string): string {
  if (!pathname.startsWith('/')) {
    throw new Error(`客户端路径必须以 / 开头：${pathname}`);
  }
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || '';
  return `${basePath}${pathname}`;
}
