import type { AgentStreamEvent } from './types';

export function parseSseBlock(block: string): AgentStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return null;
  try {
    const event = JSON.parse(data) as AgentStreamEvent;
    return event && typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    blocks.map(parseSseBlock).filter((event): event is AgentStreamEvent => Boolean(event)).forEach(onEvent);
  }
  const final = parseSseBlock(buffer + decoder.decode());
  if (final) onEvent(final);
}
