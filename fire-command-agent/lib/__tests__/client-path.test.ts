import { afterEach, describe, expect, it } from 'vitest';
import { clientPath } from '@/lib/client-path';

const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

afterEach(() => {
  if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
  else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
});

describe('clientPath', () => {
  it('prefixes local API paths with the configured base path', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/fire-digital-preplan-demo';
    expect(clientPath('/api/agent/chat')).toBe('/fire-digital-preplan-demo/api/agent/chat');
    expect(clientPath('/api/plans?limit=1')).toBe('/fire-digital-preplan-demo/api/plans?limit=1');
  });

  it('leaves paths at the root when no base path is configured', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    expect(clientPath('/api/resources')).toBe('/api/resources');
  });

  it('rejects a non-root-relative path', () => {
    expect(() => clientPath('https://platform.sanya119.online/')).toThrow('必须以 / 开头');
  });
});

