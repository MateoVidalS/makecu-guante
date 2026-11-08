import type {
  GloveConnection,
  GloveError,
  GloveEvent,
  SerialCommand,
} from '../contracts/glove';
import type { SimGlove } from './sim/simGlove';
import { WebSerialGlove } from './webSerialGlove';

/**
 * Bench mirror: test the real motors without a hand or a glove.
 *
 * The simulated patient and glove run the whole session (camera-free practice, coach,
 * assistance, rests, safety). Every command the app sends to the simulated glove is also
 * sent to a real ESP32 over Web Serial, so the servos do exactly what the app commands.
 * Servo ranges are replaced by a fixed bench range and the current limit is capped for a
 * small supply. The real board's safety events (STOP, overcurrent, watchdog, missing
 * sensor, reset) are delivered to the session, which releases and pauses as it would
 * with the real glove. The board's own limits, ramps and watchdog stay in charge.
 * Bench only: nothing may be attached to a person.
 */
export const BENCH_RANGE = { min_deg: 60, max_deg: 120 } as const;
export const BENCH_LIMIT_MA = 700;
const FORWARDED: ReadonlySet<GloveEvent['e']> = new Set([
  'boot',
  'overcurrent',
  'stop_button',
  'stop_released',
  'watchdog',
  'ina_missing',
]);

export interface BenchMirrorState {
  active: boolean;
  connection: GloveConnection;
  lastEvent: GloveEvent | null;
  lastError: GloveError | null;
  commands: number;
}

type Real = Pick<
  WebSerialGlove,
  | 'connect'
  | 'disconnect'
  | 'target'
  | 'follow'
  | 'release'
  | 'calib'
  | 'limit'
  | 'onEvent'
  | 'onError'
  | 'onConnection'
  | 'connection'
>;

export class BenchMirror {
  private real: Real | null = null;
  private sim: SimGlove | null = null;
  private unsubscribe: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private snapshot: BenchMirrorState = {
    active: false,
    connection: 'disconnected',
    lastEvent: null,
    lastError: null,
    commands: 0,
  };

  constructor(
    private readonly makeReal: () => Real = () => new WebSerialGlove(),
  ) {}

  state = () => this.snapshot;
  active = () => this.snapshot.active;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Call from a click: opening the serial port needs a user gesture. */
  async start(sim: SimGlove): Promise<void> {
    if (this.snapshot.active) return;
    if (sim.world.timeScale !== 1)
      throw new Error(
        'Bench mirror needs the simulator at real speed (VITE_SIM_SPEED=1).',
      );
    if (sim.connection() !== 'connected')
      throw new Error('Connect the simulated glove first.');
    const real = this.makeReal();
    await real.connect();
    this.real = real;
    this.sim = sim;
    this.unsubscribe = [
      real.onEvent((event) => this.onRealEvent(event)),
      real.onError((error) => this.update({ lastError: error })),
      real.onConnection((connection) => {
        this.update({ connection });
        // USB lost: the board's watchdog releases the motors; pause the session too.
        if (connection !== 'connected' && this.snapshot.active) {
          this.sim?.reportEvent({ e: 'watchdog' });
          this.stop();
        }
      }),
    ];
    this.prepareBoard();
    sim.setMirror((cmd) => this.forward(cmd));
    this.update({
      active: true,
      connection: real.connection(),
      lastError: null,
      lastEvent: null,
      commands: 0,
    });
    // The session starts from slack on both.
    sim.release();
  }

  stop(): void {
    this.sim?.setMirror(null);
    this.unsubscribe.forEach((off) => off());
    this.unsubscribe = [];
    const real = this.real;
    this.real = null;
    this.sim = null;
    if (real) {
      real.release();
      void real.disconnect();
    }
    this.update({ active: false, connection: 'disconnected' });
  }

  private prepareBoard() {
    const real = this.real!;
    real.release();
    for (const i of [0, 1, 2, 3, 4] as const)
      real.calib(i, BENCH_RANGE.min_deg, BENCH_RANGE.max_deg);
    real.limit(BENCH_LIMIT_MA);
  }

  private forward(cmd: SerialCommand) {
    const real = this.real;
    if (!real) return;
    switch (cmd.t) {
      case 'target':
        real.target(cmd.f, cmd.v);
        break;
      case 'follow':
        real.follow(cmd.f);
        break;
      case 'release':
        real.release();
        break;
      case 'calib':
        // The app's ranges belong to the (simulated) hand; the bench uses its own.
        real.calib(cmd.i, BENCH_RANGE.min_deg, BENCH_RANGE.max_deg);
        break;
      case 'limit':
        real.limit(Math.min(cmd.ma, BENCH_LIMIT_MA));
        break;
      default:
        return; // jog belongs to the calibration wizard, not to bench practice
    }
    this.update({ commands: this.snapshot.commands + 1 });
  }

  private onRealEvent(event: GloveEvent) {
    this.update({ lastEvent: event });
    // A reset forgets calibration; the session's boot handling resends it through us.
    if (event.e === 'boot') this.prepareBoard();
    if (FORWARDED.has(event.e)) {
      const { t: _t, ...rest } = event;
      this.sim?.reportEvent(rest);
    }
  }

  private update(patch: Partial<BenchMirrorState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

export const benchMirror = new BenchMirror();
