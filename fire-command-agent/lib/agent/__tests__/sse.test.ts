import { describe, expect, it } from 'vitest';
import { parseSseBlock } from '../sse';

describe('parseSseBlock', () => {
  it('parses a valid agent event', () => {
    expect(parseSseBlock('data: {"type":"text","content":"ok"}')).toEqual({ type: 'text', content: 'ok' });
  });

  it('ignores terminal and invalid blocks', () => {
    expect(parseSseBlock('data: [DONE]')).toBeNull();
    expect(parseSseBlock('data: not-json')).toBeNull();
  });
});
