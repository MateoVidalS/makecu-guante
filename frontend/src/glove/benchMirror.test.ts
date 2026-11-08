import { beforeEach, expect, it } from 'vitest';
import type {
  GloveConnection,
  GloveError,
  GloveEvent,
} from '../contracts/glove';
import { BENCH_LIMIT_MA, BENCH_RANGE, BenchMirror } from './benchMirror';
import { createSimWorld } from './sim';

class FakeBoard {
  sent: unknown[][] = [];
  status: GloveConnection = 'disconnected';
  private ev = new Set<(e: GloveEvent) => void>();
  private er = new Set<(e: GloveError) => void>();
  private co = new Set<(c: GloveConnection) => void>();
  private te = new Set<(t: never) => void>();
  onTelemetry = (cb: (t: never) => void) => {
    this.te.add(cb);
    return () => this.te.delete(cb);
  };
  tel(a: number[], tg: number[]) {
    this.boardA = a;
    this.te.forEach((cb) => cb({ a, tg, md: 'target' } as never));
  }
  connection = () => this.status;
  boardA: number[] | null = null;
  latest = () => (this.boardA ? ({ a: this.boardA } as never) : null);
  connect = async () => {
    this.status = 'connected';
    return { fw: '0.1.0', fingers: 5, limit: 1500, calib: [] };
  };
  disconnect = async () => {
    this.sent.push(['disconnect']);
    this.status = 'disconnected';
  };
  target = (f: number[], v: number) => this.sent.push(['target', f, v]);
  follow = (f: number[]) => this.sent.push(['follow', f]);
  release = () => this.sent.push(['release']);
  calib = (i: number, min: number, max: number) =>
    this.sent.push(['calib', i, min, max]);
  limit = (ma: number) => this.sent.push(['limit', ma]);
  onEvent = (cb: (e: GloveEvent) => void) => {
    this.ev.add(cb);
    return () => this.ev.delete(cb);
  };
  onError = (cb: (e: GloveError) => void) => {
    this.er.add(cb);
    return () => this.er.delete(cb);
  };
  onConnection = (cb: (c: GloveConnection) => void) => {
    this.co.add(cb);
    return () => this.co.delete(cb);
  };
  emit(e: GloveEvent) {
    this.ev.forEach((cb) => cb(e));
  }
  drop() {
    this.status = 'disconnected';
    this.co.forEach((cb) => cb('disconnected'));
  }
}

let board: FakeBoard;
let mirror: BenchMirror;
const setup = async (timeScale = 1) => {
  const world = createSimWorld({ seed: 1, autoStart: false, timeScale });
  await world.glove.connect();
  for (const i of [0, 1, 2, 3, 4] as const) world.glove.calib(i, 20, 150);
  const events: GloveEvent[] = [];
  world.glove.onEvent((e) => events.push(e));
  return { world, events };
};
beforeEach(() => {
  board = new FakeBoard();
  mirror = new BenchMirror(() => board as never);
});

it('prepares the board with the bench range and a capped limit, from slack', async () => {
  const { world } = await setup();
  await mirror.start(world.glove);
  expect(board.sent).toEqual([
    ['release'],
    ...[0, 1, 2, 3, 4].map((i) => [
      'calib',
      i,
      BENCH_RANGE.min_deg,
      BENCH_RANGE.max_deg,
    ]),
    ['limit', BENCH_LIMIT_MA],
    ['release'],
  ]);
  expect(mirror.active()).toBe(true);
});

it('sends every motion command the app sends, mapping ranges and limits', async () => {
  const { world } = await setup();
  await mirror.start(world.glove);
  board.sent = [];
  world.glove.target([0, 0.95, 0, 0, 0], 0.2);
  world.glove.follow([0.3, 0.3, 0.3, 0.3, 0.3]);
  world.glove.limit(1500);
  world.glove.limit(400);
  world.glove.calib(2, 20, 150);
  world.glove.jog(1, 95); // calibration wizard only: never mirrored
  world.glove.hello();
  world.glove.release();
  world.advance(1000); // keepalive pings stay local
  expect(board.sent).toEqual([
    ['target', [0, 0.95, 0, 0, 0], 0.2],
    ['follow', [0.3, 0.3, 0.3, 0.3, 0.3]],
    ['limit', BENCH_LIMIT_MA],
    ['limit', 400],
    ['calib', 2, BENCH_RANGE.min_deg, BENCH_RANGE.max_deg],
    ['release'],
  ]);
});

it("delivers the board's safety events to the session and re-prepares after a reset", async () => {
  const { world, events } = await setup();
  await mirror.start(world.glove);
  board.emit({ t: 1, e: 'overcurrent', ma: 750 });
  board.emit({ t: 2, e: 'stop_button' });
  board.emit({ t: 3, e: 'calib_ok' }); // the simulator reports its own
  board.sent = [];
  board.emit({ t: 4, e: 'boot', reset_reason: 9 } as GloveEvent);
  expect(events.map((e) => e.e)).toEqual([
    'overcurrent',
    'stop_button',
    'boot',
  ]);
  expect(events[0].ma).toBe(750);
  expect(board.sent[0]).toEqual(['release']);
  expect(board.sent).toContainEqual(['limit', BENCH_LIMIT_MA]);
});

it('pauses the session and stops mirroring when the board disconnects', async () => {
  const { world, events } = await setup();
  await mirror.start(world.glove);
  board.drop();
  expect(events.map((e) => e.e)).toContain('watchdog');
  expect(mirror.active()).toBe(false);
  board.sent = [];
  world.glove.target([0.5, 0.5, 0.5, 0.5, 0.5], 0.2);
  expect(board.sent).toEqual([]);
});

it('stop releases and disconnects the board; nothing more is sent', async () => {
  const { world } = await setup();
  await mirror.start(world.glove);
  board.sent = [];
  mirror.stop();
  expect(board.sent).toEqual([['release'], ['disconnect']]);
  board.sent = [];
  world.glove.target([0.5, 0.5, 0.5, 0.5, 0.5], 0.2);
  expect(board.sent).toEqual([]);
});

it('refuses an accelerated simulator, whose timing real motors cannot follow', async () => {
  const { world } = await setup(3);
  await expect(mirror.start(world.glove)).rejects.toThrow(/real speed/);
  expect(board.status).toBe('disconnected');
});

it('holds a finger the app holds where the real board is, so lag never adds a wind', async () => {
  const { world } = await setup();
  await mirror.start(world.glove);
  world.glove.target([0, 0.4, 0, 0, 0], 0.2);
  world.advance(3000); // the simulated index arrives at 0.4
  board.boardA = [0, 0.36, 0, 0, 0]; // the board lags a little behind
  board.sent = [];
  // The app starts help on the ring and keeps holding the index at 0.4.
  world.glove.target([0, 0.4, 0, 0.95, 0], 0.2);
  expect(board.sent).toEqual([['target', [0, 0.36, 0, 0.95, 0], 0.2]]);
  // While the ring winds, the index waits.
  board.tel([0, 0.36, 0, 0.5, 0], [0, 0.36, 0, 0.95, 0]);
  expect(board.sent).toHaveLength(1);
  // The ring arrived: the app's own target goes out and the index finishes.
  board.tel([0, 0.36, 0, 0.95, 0], [0, 0.36, 0, 0.95, 0]);
  expect(board.sent[1]).toEqual(['target', [0, 0.4, 0, 0.95, 0], 0.2]);
  board.tel([0, 0.4, 0, 0.95, 0], [0, 0.4, 0, 0.95, 0]);
  expect(board.sent).toHaveLength(2);
});
