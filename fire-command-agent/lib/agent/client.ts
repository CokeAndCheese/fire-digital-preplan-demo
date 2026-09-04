'use client';

import { consumeSse } from './sse';
import type { AgentApp, AgentChatRequest, AgentStreamEvent } from './types';
import { clientPath } from '@/lib/client-path';

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message || `请求失败 (${response.status})`;
}

export async function listAgentApps(signal?: AbortSignal): Promise<AgentApp[]> {
  const response = await fetch(clientPath('/api/agent/apps'), { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { rows?: AgentApp[]; result?: { rows?: AgentApp[] } };
  return payload.rows ?? payload.result?.rows ?? [];
}

export async function streamAgentChat(
  request: AgentChatRequest,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(clientPath('/api/agent/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(await responseError(response));
  await consumeSse(response.body, onEvent);
}
