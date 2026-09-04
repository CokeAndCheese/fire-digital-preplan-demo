import { agentGatewayUrl } from '@/lib/agent-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'range',
  'x-app-key',
];

const RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const requestUrl = new URL(req.url);

  let upstreamUrl: string;
  try {
    upstreamUrl = agentGatewayUrl(path, requestUrl.search);
  } catch {
    return Response.json({ error: { message: 'AGENT_GATEWAY 运行配置无效' } }, { status: 500 });
  }

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: { message: '上游请求失败' } }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
