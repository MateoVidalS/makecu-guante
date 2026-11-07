import type {
  GloveClient,
  GloveInfo,
  SerialCommand,
  Triple,
} from '../contracts/glove';
import { ClientBase } from './clientBase';
import { decode, encode } from './codec';

/** Structural interfaces allow fake ports without adding global Web Serial declarations. */
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
export interface SerialApi {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: {
    filters: { usbVendorId: number }[];
  }): Promise<SerialPortLike>;
  addEventListener?(type: 'disconnect', cb: EventListener): void;
  removeEventListener?(type: 'disconnect', cb: EventListener): void;
}
export interface WebSerialOptions {
  port?: SerialPortLike;
  serial?: SerialApi;
  now?: () => number;
  lifecycle?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}
const FILTERS = [0x10c4, 0x1a86, 0x0403].map((usbVendorId) => ({
  usbVendorId,
}));

export class WebSerialGlove extends ClientBase implements GloveClient {
  readonly kind = 'serial' as const;
  private readonly serial?: SerialApi;
  private readonly now: () => number;
  private readonly lifecycle?: WebSerialOptions['lifecycle'];
  private port?: SerialPortLike;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private readTask?: Promise<void>;
  private connectTask?: Promise<GloveInfo>;
  private closing?: Promise<void>;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private followTimer?: ReturnType<typeof setInterval>;
  private lastWritten = -Infinity;
  private lastFollow = -Infinity;
  private pendingFollow: SerialCommand | null = null;
  private queue: SerialCommand[] = [];
  private writing?: Promise<void>;
  private info: GloveInfo | null = null;
  private receiveInfo?: (info: GloveInfo) => void;
  private rejectInfo?: (error: Error) => void;
  private infoTimer?: ReturnType<typeof setTimeout>;
  constructor(options: WebSerialOptions = {}) {
    super();
    this.port = options.port;
    this.serial =
      options.serial ??
      (typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { serial?: SerialApi }).serial);
    this.now = options.now ?? (() => performance.now());
    this.lifecycle =
      options.lifecycle ?? (typeof window === 'undefined' ? undefined : window);
  }
  private onUnplug: EventListener = (event) => {
    const port =
      (event as Event & { port?: SerialPortLike }).port ?? event.target;
    if (port === this.port) void this.shutdown();
  };
  private onUnload: EventListener = () => {
    this.release();
  };
  connect(): Promise<GloveInfo> {
    if (this.status === 'connected' && this.info)
      return Promise.resolve(this.info);
    if (this.connectTask) return this.connectTask;
    this.connectTask = this.open().finally(() => {
      this.connectTask = undefined;
    });
    return this.connectTask;
  }
  private async open(): Promise<GloveInfo> {
    if (this.closing) await this.closing;
    const generation = ++this.generation;
    this.setConnection('connecting');
    this.tel = null;
    this.info = null;
    try {
      if (!this.port) {
        if (!this.serial) throw new Error('Use Chrome or Edge for the glove');
        this.port = (await this.serial.getPorts())[0];
        if (!this.port) {
          try {
            this.port = await this.serial.requestPort({ filters: FILTERS });
          } catch (error) {
            // Cancellation is intentional; retry only when filters were unsupported/no device matched.
            if (error instanceof DOMException && error.name === 'NotFoundError')
              throw error;
            this.port = await this.serial.requestPort();
          }
        }
      }
      if (generation !== this.generation)
        throw new Error('Connection cancelled');
      await this.port.open({ baudRate: 115200 });
      if (generation !== this.generation) {
        await this.port.close();
        throw new Error('Connection cancelled');
      }
      if (!this.port.readable || !this.port.writable)
        throw new Error('Serial streams unavailable');
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      const infoPromise = new Promise<GloveInfo>((resolve, reject) => {
        this.receiveInfo = resolve;
        this.rejectInfo = reject;
        this.infoTimer = setTimeout(() => reject(new Error('no_info')), 2000);
      });
      this.serial?.addEventListener?.('disconnect', this.onUnplug);
      this.lifecycle?.addEventListener('beforeunload', this.onUnload);
      this.readTask = this.readLoop(generation);
      this.lastWritten = this.now();
      this.lastFollow = -Infinity;
      this.followTimer = setInterval(() => {
        if (
          this.pendingFollow &&
          !this.writing &&
          !this.queue.length &&
          this.now() - this.lastFollow >= 1000 / 30
        ) {
          const cmd = this.pendingFollow;
          this.pendingFollow = null;
          this.enqueue(cmd);
        }
      }, 10);
      this.timer = setInterval(() => {
        if (
          this.now() - this.lastWritten >= 300 &&
          !this.writing &&
          !this.queue.length
        )
          this.enqueue({ t: 'ping' });
      }, 100);
      this.hello();
      const info = await infoPromise;
      if (generation !== this.generation)
        throw new Error('Connection cancelled');
      this.clearInfoWait();
      this.info = info;
      this.setConnection('connected');
      return info;
    } catch (error) {
      const cancelled = generation !== this.generation;
      if (!cancelled) {
        await this.shutdown();
        this.setConnection('error');
      }
      throw error;
    }
  }
  private clearInfoWait() {
    clearTimeout(this.infoTimer);
    this.infoTimer = undefined;
    this.receiveInfo = undefined;
    this.rejectInfo = undefined;
  }
  private async readLoop(generation: number) {
    const reader = this.reader!;
    const decoder = new TextDecoder();
    let line = '';
    let bytes = 0;
    let dropping = false;
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done) break;
        // Decode incrementally: arbitrary UTF-8 byte chunks and multiple lines are supported.
        for (const char of decoder.decode(value, { stream: true })) {
          if (char === '\n') {
            const message = decode(
              dropping ? ' '.repeat(201) : line,
              this.now(),
            );
            line = '';
            bytes = 0;
            dropping = false;
            if (!message) continue;
            if ('fw' in message) {
              this.info = message;
              this.receiveInfo?.(message);
            } else if ('a' in message) this.emitTelemetry(message);
            else if ('e' in message) this.events.emit(message);
            else this.errors.emit(message);
          } else if (!dropping) {
            bytes += new TextEncoder().encode(char).length;
            if (bytes > 200) {
              dropping = true;
              line = '';
            } else line += char;
          }
        }
      }
    } catch {
      /* Reader failures represent a transport disconnect, not firmware events. */
    } finally {
      reader.releaseLock();
      if (generation === this.generation) void this.shutdown();
    }
  }
  private enqueue(cmd: SerialCommand) {
    if (
      !this.writer ||
      (this.status !== 'connected' && this.status !== 'connecting')
    )
      return;
    // Validate before queuing so a bad caller cannot poison subsequent writes.
    encode(cmd);
    if (cmd.t === 'release') {
      this.pendingFollow = null;
      // A queued old movement must never re-arm the glove after release.
      this.queue = this.queue.filter(
        (c) => !['target', 'follow', 'jog'].includes(c.t),
      );
      this.queue.unshift(cmd);
    } else {
      if (cmd.t === 'target' || cmd.t === 'jog') this.pendingFollow = null;
      this.queue.push(cmd);
    }
    this.pump();
  }
  private pump() {
    if (this.writing || !this.writer || !this.queue.length) return;
    const cmd = this.queue.shift()!;
    const writer = this.writer;
    const generation = this.generation;
    if (cmd.t === 'follow') this.lastFollow = this.now();
    this.lastWritten = this.now();
    this.writing = writer
      .write(new TextEncoder().encode(encode(cmd)))
      .catch(() => {
        if (generation === this.generation) void this.shutdown();
      })
      .finally(() => {
        if (generation === this.generation) {
          this.writing = undefined;
          this.pump();
        }
      });
  }
  async disconnect() {
    if (this.writer) {
      this.release();
      // Best effort: never wait indefinitely for a broken USB writer.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 300);
        }),
      ]);
      clearTimeout(timeout);
    }
    await this.shutdown();
  }
  private async bounded(promise: Promise<unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        promise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 300);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async drain() {
    while (this.writing) await this.writing;
  }
  private shutdown(): Promise<void> {
    if (this.closing) return this.closing;
    ++this.generation;
    clearInterval(this.timer);
    clearInterval(this.followTimer);
    this.timer = undefined;
    this.followTimer = undefined;
    this.rejectInfo?.(new Error('Serial disconnected'));
    this.clearInfoWait();
    this.queue = [];
    this.pendingFollow = null;
    this.info = null;
    this.tel = null;
    this.serial?.removeEventListener?.('disconnect', this.onUnplug);
    this.lifecycle?.removeEventListener('beforeunload', this.onUnload);
    this.setConnection('disconnected');
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;
    this.reader = undefined;
    this.writer = undefined;
    this.writing = undefined;
    this.closing = (async () => {
      try {
        await reader?.cancel();
      } catch {
        /* The device may already be gone. */
      }
      await this.readTask;
      try {
        if (writer) await this.bounded(writer.abort());
      } catch {
        /* The device may already be gone. */
      }
      try {
        writer?.releaseLock();
      } catch {
        /* A write may still be pending. */
      }
      try {
        if (port) await this.bounded(port.close());
      } catch {
        /* The device may already be gone. */
      }
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  target(f: Triple, v: number) {
    this.enqueue({ t: 'target', f: [...f], v });
  }
  follow(f: Triple) {
    if (!this.writer) return;
    encode({ t: 'follow', f });
    this.pendingFollow = { t: 'follow', f: [...f] };
    if (
      this.now() - this.lastFollow >= 1000 / 30 &&
      !this.writing &&
      !this.queue.length
    ) {
      const cmd = this.pendingFollow;
      this.pendingFollow = null;
      this.enqueue(cmd);
    }
  }
  release() {
    this.enqueue({ t: 'release' });
  }
  calib(i: 0 | 1 | 2, min: number, max: number) {
    this.enqueue({ t: 'calib', i, min, max });
  }
  jog(i: 0 | 1 | 2, deg: number) {
    this.enqueue({ t: 'jog', i, deg });
  }
  limit(ma: number) {
    this.enqueue({ t: 'limit', ma });
  }
  hello() {
    this.enqueue({ t: 'hello' });
  }
}
