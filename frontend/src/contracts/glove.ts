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
  a: Quint;
  ma: number;
  st: FirmwareState;
  md: FirmwareMode;
  tg: Quint | null;
}
export interface GloveEvent {
  t: number;
  e: GloveEventKind;
  ma?: number;
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
  target(f: Quint, v: number): void;
  follow(f: Quint): void;
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
  | { t: 'evt'; e: GloveEventKind; ma?: number }
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
