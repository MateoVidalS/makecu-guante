import type { FingerId } from './vision';
import type { Unsubscribe } from './runtime';

// ---------- glove (src/contracts/glove.ts) ----------
export type GloveFinger = FingerId;
export const GLOVE_FINGERS: GloveFinger[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];
export type Quint = [number, number, number, number, number]; // [thumb, index, middle, ring, pinky]

/**
 * Glove direction (docs/plan/15-open-assist.md): the glove helps the hand OPEN.
 * Every glove-side value (`target.f`, `follow.f`, `tel.a`, `tel.tg`) is tendon PULL per finger:
 * 0 = slack (calibrated min_deg, the safe state: the hand is free), 1 = full calibrated pull
 * (max_deg, fingers straight). Vision, poses and metrics speak closure (0 open, 1 closed).
 * Convert only through these two functions.
 */
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
export const pullFromClosure = (closure: number): number => clamp01(1 - closure);
export const closureFromPull = (pull: number): number => clamp01(1 - pull);
export type FirmwareState = 'boot' | 'idle' | 'run' | 'calib' | 'fault';
export type FirmwareMode = 'none' | 'follow' | 'target' | 'jog';
export type GloveEventKind =
  | 'boot'
  | 'overcurrent'
  | 'stop_button'
  | 'watchdog'
  | 'stop_released'
  | 'ina_missing'
  | 'calib_ok';

export interface GloveTelemetry {
  t: number;
  ms: number;
  a: Quint; // commanded, ramped tendon pull (0 slack .. 1 full pull), not a measured position
  ma: number;
  st: FirmwareState;
  md: FirmwareMode;
  tg: Quint | null; // final pull goal being ramped to
}
export interface GloveEvent {
  t: number;
  e: GloveEventKind;
  ma?: number;
  reset_reason?: number; // esp_reset_reason() on boot; 9 = brown-out
}
export interface GloveInfo {
  fw: string;
  fingers: number;
  limit: number;
  calib: ([number, number] | null)[];
}
export interface GloveError {
  t: number;
  c: string;
  why: string;
}
export type GloveConnection =
  'disconnected' | 'connecting' | 'connected' | 'error';

export interface GloveClient {
  // implemented by WebSerialGlove and SimGlove (WP2)
  readonly kind: 'serial' | 'sim';
  connection(): GloveConnection;
  connect(): Promise<GloveInfo>; // serial: requestPort() needs a user gesture
  disconnect(): Promise<void>;
  target(f: Quint, v: number): void; // f = pull goals, v = pull range per second (winding; unwinding runs at V_RELEASE)
  follow(f: Quint): void; // f = pullFromClosure(vision); firmware holds max(0, f − FOLLOW_SLACK)
  release(): void;
  calib(i: 0 | 1 | 2 | 3 | 4, minDeg: number, maxDeg: number): void;
  jog(i: 0 | 1 | 2 | 3 | 4, deg: number): void;
  limit(ma: number): void;
  hello(): void;
  onTelemetry(cb: (t: GloveTelemetry) => void): Unsubscribe;
  onEvent(cb: (e: GloveEvent) => void): Unsubscribe;
  onError(cb: (e: GloveError) => void): Unsubscribe;
  onConnection(cb: (c: GloveConnection) => void): Unsubscribe;
  latest(): GloveTelemetry | null;
}
// The client sends `ping` every 300 ms on its own whenever nothing else was sent, so the watchdog only trips on a real failure.

// Wire shapes from contracts §2. Receive timestamps are added by the codec.
export type SerialCommand =
  | { t: 'target'; f: Quint; v: number }
  | { t: 'follow'; f: Quint }
  | { t: 'release' }
  | { t: 'ping' }
  | { t: 'hello' }
  | { t: 'calib'; i: 0 | 1 | 2 | 3 | 4; min: number; max: number }
  | { t: 'limit'; ma: number }
  | { t: 'jog'; i: 0 | 1 | 2 | 3 | 4; deg: number };
export type SerialMessage =
  | {
      t: 'tel';
      ms: number;
      a: Quint;
      ma: number;
      st: FirmwareState;
      md: FirmwareMode;
      tg: Quint;
    }
  | { t: 'evt'; e: GloveEventKind; ma?: number; reset_reason?: number }
  | ({ t: 'info' } & GloveInfo)
  | {
      t: 'err';
      c: string;
      why:
        | 'bad_json'
        | 'unknown_type'
        | 'bad_args'
        | 'no_calib'
        | 'fault'
        | 'state';
    };
