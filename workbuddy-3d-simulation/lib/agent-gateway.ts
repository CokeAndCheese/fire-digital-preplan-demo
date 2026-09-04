const DEFAULT_AGENT_GATEWAY = 'https://fc.xwbuilders.com';

/** Read the private gateway at request time so a standalone build stays portable. */
export function getAgentGateway(): string {
  const runtimeEnv = process.env;
  const value = (runtimeEnv.AGENT_GATEWAY || DEFAULT_AGENT_GATEWAY).trim().replace(/\/+$/, '');
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AGENT_GATEWAY 只允许 http 或 https 地址');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function agentGatewayUrl(pathSegments: string[], search = ''): string {
  if (pathSegments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('上游路径包含无效的点段');
  }
  const safePath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  const upstream = new URL(`uagent-service/${safePath}`, `${getAgentGateway()}/`);
  upstream.search = search;
  return upstream.toString();
}
