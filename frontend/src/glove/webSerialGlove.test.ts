// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebSerialGlove,
  type SerialApi,
  type SerialPortLike,
} from './webSerialGlove';
import type {
  GloveConnection,
  GloveEvent,
  SerialCommand,
} from '../contracts/glove';
import { codecStats } from './codec';

const info = {
  t: 'info',
  fw: '0.1.0',
  fingers: 3,
  limit: 900,
  calib: [null, null, null],
};
class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  controller!: ReadableStreamDefaultController<Uint8Array>;
  writes: SerialCommand[] = [];
  opened: number[] = [];
  closes = 0;
  autoInfo = true;
  failWrite = false;
  hold = false;
  unblock?: () => void;
  async open({ baudRate }: { baudRate: number }) {
    this.opened.push(baudRate);
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream({
      write: async (chunk) => {
        if (this.failWrite) throw new Error('USB write failed');
        const cmd = JSON.parse(new TextDecoder().decode(chunk));
        this.writes.push(cmd);
        if (cmd.t === 'hello' && this.autoInfo)
          this.receive(JSON.stringify(info) + '\n');
        if (this.hold)
          await new Promise<void>((resolve) => {
            this.unblock = resolve;
          });
      },
    });
  }
  async close() {
    this.closes++;
  }
  receive(text: string) {
    this.controller.enqueue(new TextEncoder().encode(text));
  }
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function setup() {
  const port = new FakePort();
  const bus = new EventTarget();
  const lifecycle = new EventTarget();
  const serial: SerialApi = {
    getPorts: vi.fn(async () => [port]),
    requestPort: vi.fn(async () => port),
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
  };
  const client = new WebSerialGlove({
    serial,
    lifecycle,
    now: () => Date.now(),
  });
  return { port, bus, lifecycle, serial, client };
}
let clients: WebSerialGlove[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
});
afterEach(async () => {
  for (const client of clients) await client.disconnect();
  vi.useRealTimers();
});

describe('Web Serial connection lifecycle', () => {
  it('reuses granted port, opens 115200, handshakes, releases and reconnects without a prompt', async () => {
    const { port, serial, client } = setup();
    clients.push(client);
    expect(await client.connect()).toMatchObject({ fw: '0.1.0' });
    expect(client.connection()).toBe('connected');
    expect(port.opened).toEqual([115200]);
    expect(serial.requestPort).not.toHaveBeenCalled();
    await client.disconnect();
    expect(port.writes.at(-1)?.t).toBe('release');
    expect(port.closes).toBe(1);
    await client.connect();
    expect(port.opened).toEqual([115200, 115200]);
  });
  it('uses USB vendor filters and retries unfiltered when filters are unsupported', async () => {
    const { client, serial, port } = setup();
    clients.push(client);
    vi.mocked(serial.getPorts).mockResolvedValue([]);
    vi.mocked(serial.requestPort)
      .mockRejectedValueOnce(new TypeError('filters unsupported'))
      .mockResolvedValueOnce(port);
    await client.connect();
    expect(serial.requestPort).toHaveBeenNthCalledWith(1, {
      filters: [
        { usbVendorId: 0x10c4 },
        { usbVendorId: 0x1a86 },
        { usbVendorId: 0x0403 },
      ],
    });
    expect(serial.requestPort).toHaveBeenNthCalledWith(2);
  });
  it('does not reopen the chooser after user cancellation', async () => {
    const { client, serial } = setup();
    clients.push(client);
    vi.mocked(serial.getPorts).mockResolvedValue([]);
    vi.mocked(serial.requestPort).mockRejectedValue(
      new DOMException('Cancelled', 'NotFoundError'),
    );
    await expect(client.connect()).rejects.toThrow('Cancelled');
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });
  it('concurrent connect calls share a single handshake', async () => {
    const { client, port } = setup();
    clients.push(client);
    const a = client.connect(),
      b = client.connect();
    expect(a).toBe(b);
    await a;
    expect(port.opened).toHaveLength(1);
  });
  it('rejects no_info after two seconds and frees all stream locks', async () => {
    const { client, port } = setup();
    clients.push(client);
    port.autoInfo = false;
    const result = expect(client.connect()).rejects.toThrow('no_info');
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(client.connection()).toBe('error');
    expect(port.closes).toBe(1);
    expect(port.readable?.locked).toBe(false);
    expect(port.writable?.locked).toBe(false);
  });
  it('reports the unsupported browser error', async () => {
    const client = new WebSerialGlove();
    clients.push(client);
    await expect(client.connect()).rejects.toThrow(
      'Use Chrome or Edge for the glove',
    );
    expect(client.connection()).toBe('error');
  });
  it.each(['eof', 'reader error', 'disconnect event', 'writer error'])(
    '%s emits disconnected, without inventing a firmware event',
    async (reason) => {
      const { client, port, bus } = setup();
      clients.push(client);
      await client.connect();
      const states: GloveConnection[] = [],
        events: GloveEvent[] = [];
      client.onConnection((s) => states.push(s));
      client.onEvent((e) => events.push(e));
      if (reason === 'eof') port.controller.close();
      else if (reason === 'reader error')
        port.controller.error(new Error('USB gone'));
      else if (reason === 'writer error') {
        port.failWrite = true;
        client.hello();
      } else {
        const event = new Event('disconnect');
        Object.defineProperty(event, 'port', { value: port });
        bus.dispatchEvent(event);
      }
      await flush();
      expect(states).toEqual(['disconnected']);
      expect(events).toEqual([]);
      expect(client.latest()).toBeNull();
      expect(port.closes).toBe(1);
    },
  );
  it('a handshake interrupted by disconnect rejects promptly and reconnects cleanly', async () => {
    const { client, port } = setup();
    clients.push(client);
    port.autoInfo = false;
    const result = expect(client.connect()).rejects.toThrow(
      'Serial disconnected',
    );
    await flush();
    port.controller.close();
    await flush();
    await result;
    expect(client.connection()).toBe('disconnected');
    port.autoInfo = true;
    await client.connect();
    expect(client.connection()).toBe('connected');
  });
  it('disconnect and reconnect remain usable after a driver write never resolves', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    await flush();
    port.hold = true;
    client.target([1, 1, 1], 0.3);
    await flush();
    const unblocked = port.unblock;
    const closing = client.disconnect();
    await vi.advanceTimersByTimeAsync(650);
    await closing;
    expect(client.connection()).toBe('disconnected');
    expect(port.readable?.locked).toBe(false);
    expect(port.writable?.locked).toBe(false);
    port.hold = false;
    await client.connect();
    unblocked?.();
    await flush();
    client.limit(600);
    await flush();
    expect(port.writes.at(-1)).toEqual({ t: 'limit', ma: 600 });
  });
  it('bounds a stalled reader cancellation so simulator recovery can continue', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    const cancel = vi
      .spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
      .mockImplementation(() => new Promise<void>(() => {}));
    const closing = client.disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(client.connection()).toBe('disconnected');
    expect(port.closes).toBe(1);
    cancel.mockRestore();
    port.controller.close();
  });
  it('disconnect rejects new motion while draining and a concurrent reconnect waits for cleanup', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    await flush();
    port.hold = true;
    client.limit(600);
    await flush();
    const closing = client.disconnect();
    client.target([1, 1, 1], 0.3);
    client.follow([1, 1, 1]);
    const reconnect = client.connect();
    port.hold = false;
    port.unblock?.();
    await closing;
    await reconnect;
    expect(
      port.writes.filter((c) => c.t === 'target' || c.t === 'follow'),
    ).toEqual([]);
    expect(client.connection()).toBe('connected');
  });
  it('beforeunload writes a best-effort release and removes its listener on disconnect', async () => {
    const { client, port, lifecycle } = setup();
    clients.push(client);
    await client.connect();
    lifecycle.dispatchEvent(new Event('beforeunload'));
    await flush();
    expect(port.writes.at(-1)?.t).toBe('release');
    await client.disconnect();
    const count = port.writes.length;
    lifecycle.dispatchEvent(new Event('beforeunload'));
    await flush();
    expect(port.writes).toHaveLength(count);
  });
});

describe('Web Serial framing and scheduling', () => {
  it('handles partial/multiple CRLF lines, ignores unknown fields, recovers from oversized and malformed lines', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    const before = codecStats.malformedLines;
    const tel = {
      t: 'tel',
      ms: 20,
      a: [0, 0.2, 0.3],
      tg: [0, 0.4, 0.5],
      ma: 300,
      st: 'run',
      md: 'target',
      extra: 1,
    };
    const received: unknown[] = [],
      events: unknown[] = [],
      errors: unknown[] = [];
    client.onTelemetry((v) => received.push(v));
    client.onEvent((v) => events.push(v));
    client.onError((v) => errors.push(v));
    const line = JSON.stringify(tel);
    port.receive(line.slice(0, 20));
    await flush();
    expect(received).toEqual([]);
    port.receive(line.slice(20) + '\r\n{\n' + 'x'.repeat(5000));
    await flush();
    port.receive(
      '\n{"t":"evt","e":"boot"}\n{"t":"err","c":"target","why":"no_calib"}\n',
    );
    await flush();
    expect(received).toHaveLength(1);
    expect(client.latest()?.a).toEqual([0, 0.2, 0.3]);
    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(codecStats.malformedLines - before).toBe(2);
  });
  it('keepalive pings after 300 ms of silence; commands reset the deadline', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    await vi.advanceTimersByTimeAsync(299);
    expect(port.writes.filter((c) => c.t === 'ping')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(port.writes.at(-1)?.t).toBe('ping');
    await vi.advanceTimersByTimeAsync(200);
    client.limit(600);
    await flush();
    await vi.advanceTimersByTimeAsync(290);
    expect(port.writes.at(-1)?.t).toBe('limit');
    await vi.advanceTimersByTimeAsync(10);
    expect(port.writes.at(-1)?.t).toBe('ping');
  });
  it('follow is at most 30 Hz and keeps only the newest pending closure', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    for (let i = 0; i < 100; i++) {
      client.follow([i / 100, 0, 0]);
      await vi.advanceTimersByTimeAsync(1);
    }
    await vi.advanceTimersByTimeAsync(50);
    const follows = port.writes.filter((c) => c.t === 'follow');
    expect(follows.length).toBeLessThanOrEqual(5);
    expect(follows.at(-1)).toEqual({ t: 'follow', f: [0.99, 0, 0] });
  });
  it('release jumps queued configuration, discards stale movement and cancels pending follow', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    await flush();
    port.hold = true;
    client.target([0.2, 0.2, 0.2], 0.3);
    await flush();
    client.target([1, 1, 1], 0.3);
    client.follow([0.5, 0.5, 0.5]);
    client.jog(0, 90);
    client.calib(0, 20, 150);
    client.limit(600);
    client.release();
    port.hold = false;
    port.unblock?.();
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(port.writes.map((c) => c.t)).toEqual([
      'hello',
      'target',
      'release',
      'calib',
      'limit',
    ]);
  });
  it('target cancels a pending old follow and ordinary non-follow commands are never dropped', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    client.follow([0.1, 0.1, 0.1]);
    await flush();
    client.follow([0.2, 0.2, 0.2]);
    client.target([1, 1, 1], 0.3);
    client.calib(0, 20, 150);
    client.jog(0, 90);
    client.limit(600);
    client.hello();
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(port.writes.map((c) => c.t)).toEqual([
      'hello',
      'follow',
      'target',
      'calib',
      'jog',
      'limit',
      'hello',
    ]);
  });
  it('slow writes coalesce follow without accumulating a backlog', async () => {
    const { client, port } = setup();
    clients.push(client);
    await client.connect();
    await flush();
    port.hold = true;
    client.limit(700);
    await flush();
    for (let i = 0; i < 100; i++) {
      client.follow([i / 100, 0, 0]);
      await vi.advanceTimersByTimeAsync(10);
    }
    port.hold = false;
    port.unblock?.();
    await flush();
    await vi.advanceTimersByTimeAsync(50);
    expect(port.writes.filter((c) => c.t === 'follow')).toEqual([
      { t: 'follow', f: [0.99, 0, 0] },
    ]);
  });
});
