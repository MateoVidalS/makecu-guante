import type {
  GloveClient,
  GloveTelemetry,
  GloveEvent,
  GloveError,
  GloveConnection,
  GloveInfo,
  Quint,
} from '../contracts/glove';
import type { Unsubscribe } from '../contracts/runtime';

// Scripted telemetry only. WP2 replaces this with WebSerialGlove and SimGlove.
export class StubGlove implements GloveClient {
  readonly kind = 'sim' as const;
  private status: GloveConnection = 'disconnected';
  private timer: ReturnType<typeof setInterval> | null = null;
  private tel: GloveTelemetry | null = null;
  private goal: Quint = [0, 0, 0, 0, 0];
  private mode: GloveTelemetry['md'] = 'none';
  private telemetry = new Set<(t: GloveTelemetry) => void>();
  private events = new Set<(e: GloveEvent) => void>();
  private errors = new Set<(e: GloveError) => void>();
  private connections = new Set<(c: GloveConnection) => void>();
  connection() {
    return this.status;
  }
  async connect(): Promise<GloveInfo> {
    this.status = 'connected';
    this.connections.forEach((cb) => cb(this.status));
    if (!this.timer)
      this.timer = setInterval(() => {
        const t = performance.now();
        this.tel = {
          t,
          ms: Math.floor(t),
          a: [...this.goal],
          tg: [...this.goal],
          ma: this.mode === 'none' ? 80 : 240,
          st: this.mode === 'none' ? 'idle' : 'run',
          md: this.mode,
        };
        this.telemetry.forEach((cb) => cb(this.tel!));
      }, 20);
    return {
      fw: 'WP0-stub',
      fingers: 5,
      limit: 900,
      calib: [null, null, null, null, null],
    };
  }
  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.release();
    this.status = 'disconnected';
    this.connections.forEach((cb) => cb(this.status));
  }
  target(f: Quint, _v: number) {
    this.goal = [...f];
    this.mode = 'target';
  }
  follow(f: Quint) {
    this.goal = f.map((v) => Math.max(0, v - 0.05)) as Quint;
    this.mode = 'follow';
  }
  release() {
    this.goal = [0, 0, 0, 0, 0];
    this.mode = 'none';
  }
  calib(_i: 0 | 1 | 2 | 3 | 4, _minDeg: number, _maxDeg: number) {
    /* WP2 */
  }
  jog(_i: 0 | 1 | 2 | 3 | 4, _deg: number) {
    /* WP2 */
  }
  limit(_ma: number) {
    /* WP2 */
  }
  hello() {
    /* WP2 */
  }
  latest() {
    return this.tel;
  }
  onTelemetry(cb: (t: GloveTelemetry) => void): Unsubscribe {
    this.telemetry.add(cb);
    return () => {
      this.telemetry.delete(cb);
    };
  }
  onEvent(cb: (e: GloveEvent) => void): Unsubscribe {
    this.events.add(cb);
    return () => {
      this.events.delete(cb);
    };
  }
  onError(cb: (e: GloveError) => void): Unsubscribe {
    this.errors.add(cb);
    return () => {
      this.errors.delete(cb);
    };
  }
  onConnection(cb: (c: GloveConnection) => void): Unsubscribe {
    this.connections.add(cb);
    return () => {
      this.connections.delete(cb);
    };
  }
}
