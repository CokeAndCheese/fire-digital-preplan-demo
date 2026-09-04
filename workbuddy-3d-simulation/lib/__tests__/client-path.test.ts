import { describe, expect, it } from 'vitest';
import { normalizeBasePath, withBasePath } from '@/lib/client-path';

describe('client path helpers', () => {
  it('normalizes an optional trailing slash and root', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath(' /fire-digital-preplan-demo/scene/ ')).toBe('/fire-digital-preplan-demo/scene');
  });

  it('rejects values that are not URL path prefixes', () => {
    expect(() => normalizeBasePath('fire/scene')).toThrow();
    expect(() => normalizeBasePath('/fire//scene')).toThrow();
    expect(() => normalizeBasePath('/fire/scene?x=1')).toThrow();
    expect(() => normalizeBasePath('/fire\\scene')).toThrow();
  });

  it('keeps external URLs untouched and prefixes local paths', () => {
    expect(withBasePath('https://gateway.example.test/uagent-service')).toBe('https://gateway.example.test/uagent-service');
    expect(withBasePath('//cdn.example.test/model.glb')).toBe('//cdn.example.test/model.glb');
    expect(() => withBasePath('api/scene')).toThrow();
  });
});

