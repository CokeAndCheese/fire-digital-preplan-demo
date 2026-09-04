import { afterEach, describe, expect, it } from 'vitest';
import { agentGatewayUrl, getAgentGateway } from '@/lib/agent-gateway';

const originalGateway = process.env.AGENT_GATEWAY;

afterEach(() => {
  if (originalGateway === undefined) delete process.env.AGENT_GATEWAY;
  else process.env.AGENT_GATEWAY = originalGateway;
});

describe('runtime agent gateway', () => {
  it('reads and normalizes the private runtime value', () => {
    process.env.AGENT_GATEWAY = 'https://gateway.example.test/base///';
    expect(getAgentGateway()).toBe('https://gateway.example.test/base');
  });

  it('rejects non-http gateway schemes', () => {
    process.env.AGENT_GATEWAY = 'file:///tmp/upstream';
    expect(() => getAgentGateway()).toThrow(/http/);
  });

  it('encodes path segments and preserves the request query', () => {
    process.env.AGENT_GATEWAY = 'https://gateway.example.test/base/';
    expect(agentGatewayUrl(['api', 'a b'], '?preview=true')).toBe(
      'https://gateway.example.test/base/uagent-service/api/a%20b?preview=true',
    );
  });

  it('rejects traversal dot segments', () => {
    process.env.AGENT_GATEWAY = 'https://gateway.example.test';
    expect(() => agentGatewayUrl(['api', '..'])).toThrow(/点段/);
  });
});
