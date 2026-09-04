// SDK 的 MultiAgentSDK.agentChatSSE 请求 /uagent-service/api/agent/v1/apps/agent-chat。
// 用 Route Handler 手动 fetch 上游，把上游的 ReadableStream 直接作为响应体返回，
// 逐块透传 SSE，避免走 next.config 的 rewrite 代理（rewrites 会把 SSE 整段缓冲）。
//
// 说明：本精确 route 优先于同目录的运行时 catch-all 代理，专门保持 SSE 流式透传。

import { getAgentGateway } from '@/lib/agent-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let upstreamUrl: string;
  try {
    upstreamUrl = `${getAgentGateway()}/uagent-service/api/agent/v1/apps/agent-chat`;
  } catch {
    return Response.json({ error: { message: 'AGENT_GATEWAY 运行配置无效' } }, { status: 500 });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  const appKey = req.headers.get('x-app-key');
  if (appKey) headers['X-App-Key'] = appKey;
  const cookie = req.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;

  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method: 'POST', headers, body, cache: 'no-store' });
  } catch {
    return new Response(JSON.stringify({ error: { message: '上游请求失败' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
