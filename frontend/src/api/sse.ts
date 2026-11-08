import type { ChatStreamEvent } from '../contracts/chat';

/** Incremental SSE decoding; chunks may split UTF-8 characters, lines or events. */
export async function parseChatEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const dispatch = (frame: string) => {
    const data = frame
      .split(/\r\n|\r|\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const event = JSON.parse(data) as ChatStreamEvent;
    if (!['delta', 'tool', 'done', 'error'].includes(event.type))
      throw new Error('Unknown chat event');
    onEvent(event);
    terminal = event.type === 'done' || event.type === 'error';
  };
  try {
    signal?.throwIfAborted();
    while (!terminal) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!terminal && (boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        dispatch(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (done) break;
    }
    if (!terminal) throw new Error('Chat stream ended before completion');
  } finally {
    signal?.removeEventListener('abort', abort);
    // Some fetch adapters defer cancellation until their cloned body drains.
    // A terminal event must finish the UI turn without waiting for that drain.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
