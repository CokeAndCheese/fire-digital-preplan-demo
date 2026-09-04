import 'server-only';

const DEFAULT_GATEWAY = 'https://fc.xwbuilders.com';
const DEFAULT_GATEWAY_TIMEOUT_MS = 12_000;
const DEFAULT_AGENT_STREAM_TIMEOUT_MS = 90_000;

function gatewayTimeoutMs() {
  const configured = Number.parseInt(process.env.AGENT_GATEWAY_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_GATEWAY_TIMEOUT_MS;
}

export function agentStreamTimeoutMs() {
  const configured = Number.parseInt(process.env.AGENT_STREAM_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : DEFAULT_AGENT_STREAM_TIMEOUT_MS;
}

export function hasAgentCredentials() {
  return Boolean((process.env.AGENT_APP_KEY || '').trim());
}

/** Keep provider exceptions useful without allowing credentials into API responses or logs. */
export function redactAgentDiagnostic(value: unknown, additionalSecrets: string[] = []) {
  let message = value instanceof Error ? value.message : typeof value === 'string' ? value : '八维通请求失败。';
  const secrets = [(process.env.AGENT_APP_KEY || '').trim(), ...additionalSecrets].filter(Boolean);
  for (const secret of secrets) message = message.replaceAll(secret, '[REDACTED]');
  return message
    .replace(/(x-app-key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]');
}

export async function agentGatewayFetch(path: string, init: RequestInit = {}) {
  const gateway = (process.env.AGENT_GATEWAY || DEFAULT_GATEWAY).trim().replace(/\/+$/, '');
  const key = (process.env.AGENT_APP_KEY || '').trim();
  if (!key) throw new Error('未配置 AGENT_APP_KEY。');
  const headers = new Headers(init.headers);
  headers.set('X-App-Key', key);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = gatewayTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeout);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

  try {
    return await fetch(`${gateway}/uagent-service/${path.replace(/^\/+/, '')}`, {
      ...init,
      headers,
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new Error(`八维通网关在 ${Math.round(timeout / 1000)} 秒内未响应，请稍后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyResponse(response: Response) {
  return new Response(JSON.stringify({ message: '平台暂不可用，本次操作未完成。' }), {
    status: response.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
