import type { Calibration } from '../../contracts/calibration';
import type { GloveEvent, GloveTelemetry, Quint } from '../../contracts/glove';
import type { VisionFrame } from '../../contracts/vision';
import type { EngineInput, GloveCommand } from '../types';
import calibrationFixture from '../../../../contracts/fixtures/calibration.json';

export const calibration: Calibration = calibrationFixture as Calibration;
export const curve = (points: [number, number][], time: number): number => {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    if (time <= x) return py + ((y - py) * (time - px)) / (x - px);
  }
  return points[points.length - 1][1];
};

/** Local command echo with ramps and scripted events; intentionally independent of WP2. */
export class FakeWorld {
  now = 0;
  confidence = 1;
  detected = true;
  connected = true;
  pinch: number | null = 0.1;
  hand: Quint = [0, 0, 0, 0, 0];
  ma = 100;
  tel: GloveTelemetry = {
    t: 0,
    ms: 0,
    a: [0, 0, 0, 0, 0],
    ma: 100,
    st: 'idle',
    md: 'none',
    tg: [0, 0, 0, 0, 0],
  };
  private goal: Quint = [0, 0, 0, 0, 0];
  private speed = 1;
  private scripts: { at: number; event: GloveEvent['e']; ma?: number }[] = [];

  apply(commands: GloveCommand[]): void {
    for (const cmd of commands) {
      if (cmd.t === 'limit') continue;
      if (cmd.t === 'release') {
        this.goal = [0, 0, 0, 0, 0];
        this.speed = 2;
        this.tel.st = 'idle';
        this.tel.md = 'none';
      } else if (this.tel.st !== 'fault') {
        this.goal =
          cmd.t === 'follow'
            ? (cmd.f.map((v) => Math.max(0, v - 0.03)) as Quint)
            : [...cmd.f];
        this.speed = cmd.t === 'follow' ? 2 : cmd.v;
        this.tel.st = 'run';
        this.tel.md = cmd.t;
      }
      this.tel.tg = [...this.goal];
    }
  }
  schedule(at: number, event: GloveEvent['e'], ma?: number): void {
    this.scripts.push({ at, event, ma });
  }
  step(ms = 50): EngineInput {
    const before = this.now;
    this.now += ms;
    const a = this.tel.a.map(
      (v, i) =>
        v +
        Math.sign(this.goal[i] - v) *
          Math.min(Math.abs(this.goal[i] - v), (this.speed * ms) / 1000),
    ) as Quint;
    const gloveEvents: GloveEvent[] = this.scripts
      .filter((s) => s.at > before && s.at <= this.now)
      .map((s) => ({ t: s.at, e: s.event, ma: s.ma }));
    if (
      gloveEvents.some((e) =>
        ['overcurrent', 'stop_button', 'watchdog'].includes(e.e),
      )
    ) {
      this.tel.st = 'fault';
      this.goal = [0, 0, 0, 0, 0];
    }
    this.tel = { ...this.tel, t: this.now, ms: this.now, a, ma: this.ma };
    const vision: VisionFrame = {
      t: this.now,
      confidence: this.confidence,
      detected: this.detected,
      closure: {
        thumb: this.hand[0],
        index: this.hand[1],
        middle: this.hand[2],
        ring: this.hand[3],
        pinky: this.hand[4],
      },
      handedness: 'right',
      rawFlexSum: null,
      joints: null,
      pinch: this.pinch,
      landmarks: null,
    };
    return {
      now: this.now,
      vision,
      tel: { ...this.tel, a: [...a] },
      gloveConnected: this.connected,
      gloveEvents,
    };
  }
}
