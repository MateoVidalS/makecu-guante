import type {
  GloveClient,
  GloveEvent,
  GloveInfo,
  SerialCommand,
  Quint,
} from '../../contracts/glove';
import { ClientBase } from '../clientBase';
import type { SimWorld } from './simWorld';

/** One transport endpoint on a shared world. Calibration is intentionally never preloaded. */
export class SimGlove extends ClientBase implements GloveClient {
  readonly kind = 'sim' as const;
  private lastSent = 0;
  private booted = false;
  /** Bench mirror (glove/benchMirror.ts): also sends each command to a real board. */
  private mirror: ((cmd: SerialCommand) => void) | null = null;
  constructor(readonly world: SimWorld) {
    super();
    world.ticks.subscribe((now) => {
      if (this.status === 'connected' && now - this.lastSent >= 300)
        this.send({ t: 'ping' });
    });
    world.telemetry.subscribe((now) => {
      if (this.status === 'connected')
        this.emitTelemetry({
          ...world.firmware.telemetry(now),
          t: world.timestamp(),
        });
    });
    world.firmware.events.subscribe((event) => {
      if (this.status === 'connected')
        this.events.emit({ ...event, t: world.timestamp() });
    });
    world.firmware.errors.subscribe((error) => {
      if (this.status === 'connected')
        this.errors.emit({ ...error, t: world.timestamp() });
    });
  }
  async connect(): Promise<GloveInfo> {
    if (this.status === 'connected') return this.world.firmware.info();
    this.setConnection('connecting');
    this.tel = null;
    this.lastSent = this.world.now;
    this.setConnection('connected');
    if (!this.booted) {
      this.booted = true;
      this.world.firmware.boot(this.world.now);
    }
    this.send({ t: 'hello' });
    this.world.start();
    return this.world.firmware.info();
  }
  async disconnect() {
    this.release();
    this.unplug();
  }
  unplug() {
    this.tel = null;
    this.setConnection('disconnected');
  }
  private send(cmd: SerialCommand) {
    if (this.status !== 'connected') return;
    this.lastSent = this.world.now;
    this.world.firmware.handle(cmd, this.world.now);
    if (this.mirror && cmd.t !== 'ping' && cmd.t !== 'hello') this.mirror(cmd);
  }
  setMirror(mirror: ((cmd: SerialCommand) => void) | null) {
    this.mirror = mirror;
  }
  /** A real board's safety event, delivered to the session like a simulated one. */
  reportEvent(event: Omit<GloveEvent, 't'>) {
    if (this.status === 'connected')
      this.events.emit({ ...event, t: this.world.timestamp() } as GloveEvent);
  }
  target(f: Quint, v: number) {
    this.send({ t: 'target', f, v });
  }
  follow(f: Quint) {
    this.send({ t: 'follow', f });
  }
  release() {
    this.send({ t: 'release' });
  }
  calib(i: 0 | 1 | 2 | 3 | 4, min: number, max: number) {
    this.send({ t: 'calib', i, min, max });
  }
  jog(i: 0 | 1 | 2 | 3 | 4, deg: number) {
    this.send({ t: 'jog', i, deg });
  }
  limit(ma: number) {
    this.send({ t: 'limit', ma });
  }
  hello() {
    this.send({ t: 'hello' });
  }
}
