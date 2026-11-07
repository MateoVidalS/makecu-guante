import type {
  GloveTelemetry,
  GloveEvent,
  GloveInfo,
  GloveError,
  SerialCommand,
} from '../contracts/glove';

export type DecodedMessage =
  GloveTelemetry | GloveEvent | GloveInfo | GloveError;
export const codecStats = { malformedLines: 0 };
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const triple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(finite);
const states = ['boot', 'idle', 'run', 'calib', 'fault'];
const modes = ['none', 'follow', 'target', 'jog'];
const events = [
  'boot',
  'overcurrent',
  'stop_button',
  'watchdog',
  'stop_released',
  'ina_missing',
  'calib_ok',
];
const reasons = [
  'bad_json',
  'unknown_type',
  'bad_args',
  'no_calib',
  'fault',
  'state',
];

export function encode(command: SerialCommand): string {
  const line = JSON.stringify(command, (_key, value: unknown) => {
    if (typeof value !== 'number') return value;
    if (!Number.isFinite(value))
      throw new Error('Serial numbers must be finite');
    return Math.round(value * 1000) / 1000;
  });
  if (new TextEncoder().encode(line).length > 200)
    throw new Error('Serial line exceeds 200 bytes');
  return line + '\n';
}

export function decode(
  line: string,
  now = performance.now(),
): DecodedMessage | null {
  try {
    if (new TextEncoder().encode(line.replace(/\r$/, '')).length > 200)
      throw new Error();
    const v = JSON.parse(line);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    if (
      v.t === 'tel' &&
      finite(v.ms) &&
      v.ms >= 0 &&
      triple(v.a) &&
      finite(v.ma) &&
      states.includes(v.st) &&
      modes.includes(v.md) &&
      (v.tg === null || triple(v.tg))
    ) {
      return {
        t: now,
        ms: v.ms,
        a: v.a,
        ma: v.ma,
        st: v.st,
        md: v.md,
        tg: v.tg,
      };
    }
    if (
      v.t === 'evt' &&
      events.includes(v.e) &&
      (v.ma === undefined || finite(v.ma))
    ) {
      return { t: now, e: v.e, ...(v.ma === undefined ? {} : { ma: v.ma }) };
    }
    if (
      v.t === 'info' &&
      typeof v.fw === 'string' &&
      v.fingers === 3 &&
      finite(v.limit) &&
      Array.isArray(v.calib) &&
      v.calib.length === 3 &&
      v.calib.every(
        (c: unknown) =>
          c === null || (Array.isArray(c) && c.length === 2 && c.every(finite)),
      )
    ) {
      return { fw: v.fw, fingers: v.fingers, limit: v.limit, calib: v.calib };
    }
    if (v.t === 'err' && typeof v.c === 'string' && reasons.includes(v.why)) {
      return { t: now, c: v.c, why: v.why };
    }
  } catch {
    /* A bad line must never break the reader. */
  }
  codecStats.malformedLines++;
  return null;
}
