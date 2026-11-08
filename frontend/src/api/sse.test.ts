import { describe, expect, it, vi } from 'vitest';
import { parseChatEvents } from './sse';

function chunks(parts: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  });
}
describe('chat SSE decoding', () => {
  it('handles split JSON, CRLF separators, multiline data and split UTF-8', async () => {
    const wire =
      ': heartbeat\r\ndata: {"type":"delta",\r\ndata: "text":"Café\\nanswer"}\r\n\r\ndata: {"type":"done","model":"fixture"}\n\n';
    const bytes = new TextEncoder().encode(wire);
    const receive = vi.fn();
    await parseChatEvents(
      chunks([...bytes].map((byte) => Uint8Array.of(byte))),
      receive,
    );
    expect(receive.mock.calls.map(([event]) => event)).toEqual([
      { type: 'delta', text: 'Café\nanswer' },
      { type: 'done', model: 'fixture' },
    ]);
  });
  it('rejects incomplete and malformed responses', async () => {
    await expect(parseChatEvents(chunks([]), vi.fn())).rejects.toThrow(
      'before completion',
    );
    await expect(
      parseChatEvents(
        chunks([new TextEncoder().encode('data: nope\n\n')]),
        vi.fn(),
      ),
    ).rejects.toThrow();
  });
  it('cancels a pending reader on abort', async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const result = parseChatEvents(
      new ReadableStream({ cancel: cancelled }),
      vi.fn(),
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalled();
  });
});
