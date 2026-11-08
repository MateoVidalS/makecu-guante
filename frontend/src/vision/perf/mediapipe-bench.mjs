/* global process, window, console */
/**
 * Real-MediaPipe hand-position benchmark (opt-in, not part of `make test`).
 *
 *   pnpm --dir frontend bench:vision            # writes src/vision/perf/mediapipe-bench.result.json
 *   REHAB_BENCH_QUICK=1 pnpm --dir frontend bench:vision
 *
 * Renders a skin-toned capsule hand (the virtual hand's rig) at known joint
 * angles, runs the bundled MediaPipe Hand Landmarker (CPU delegate, headless
 * Chromium) and pushes its landmarks through the production joint math.
 * The rendered hand is a proxy: these numbers bound the software, they do not
 * replace recordings of the real glove on a real patient.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const quick = !!process.env.REHAB_BENCH_QUICK;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const LONG = ['index', 'middle', 'ring', 'pinky'];
const FIST = { mcp: 90, pip: 100, dip: 80 };
const THUMB_FIST = { mcp: 50, pip: 50, dip: 0 };
const POSES = {
  open: [
    { mcp: 0, pip: 0, dip: 0 },
    { mcp: 0, pip: 0, dip: 0 },
  ],
  tabletop: [
    { mcp: 90, pip: 0, dip: 0 },
    { mcp: 20, pip: 10, dip: 0 },
  ],
  hook: [
    { mcp: 0, pip: 90, dip: 70 },
    { mcp: 10, pip: 10, dip: 0 },
  ],
  straight_fist: [
    { mcp: 90, pip: 100, dip: 0 },
    { mcp: 40, pip: 30, dip: 0 },
  ],
  full_fist: [FIST, THUMB_FIST],
};
// Engine targets (contracts/poses.ts) for the scored fingers; null = free.
const TARGETS = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  tabletop: { thumb: null, index: 0.35, middle: 0.35, ring: 0.35, pinky: 0.35 },
  hook: { thumb: null, index: 0.6, middle: 0.6, ring: 0.6, pinky: 0.6 },
  straight_fist: { thumb: 0.5, index: 0.7, middle: 0.7, ring: 0.7, pinky: 0.7 },
  full_fist: { thumb: 0.7, index: 0.95, middle: 0.95, ring: 0.95, pinky: 0.95 },
};
const TOLERANCE = 0.1;
const hand = ([long, thumb]) => ({
  thumb,
  ...Object.fromEntries(LONG.map((f) => [f, long])),
});
const scaled = (s) =>
  hand([
    { mcp: FIST.mcp * s, pip: FIST.pip * s, dip: FIST.dip * s },
    { mcp: THUMB_FIST.mcp * s, pip: THUMB_FIST.pip * s, dip: 0 },
  ]);
const sum = (j) => j.mcp + j.pip + j.dip;
const trueSums = (joints) =>
  Object.fromEntries(FINGERS.map((f) => [f, sum(joints[f])]));
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const std = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const pct = (v, p) =>
  [...v].sort((a, b) => a - b)[
    Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)
  ];
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}src/vision/perf/mediapipe-bench.html`);
await page.waitForFunction(() => window.bench);
await page.evaluate(() => window.bench.init('CPU'));
const shoot = (shot) => page.evaluate((s) => window.bench.shoot(s), shot);

const views = ['front_upright', 'front_diagonal'];
const hands = quick ? ['right'] : ['right', 'left'];
const seeds = quick ? [1, 2] : [1, 2, 3, 4];
const shotNoise = { sensorNoise: 4, shiftPx: 0.5 };
const inference = [];
const report = {
  date: new Date().toISOString(),
  method:
    'Rendered capsule hand (hand3d rig) with known joint angles; bundled MediaPipe Hand Landmarker, CPU delegate, ' +
    'headless Chromium (SwiftShader), 640x480; production jointAngles/pinchRatio. Proxy for, not a replacement of, real glove recordings.',
  sweep: [],
  poses: [],
  tilt: [],
  jitter: [],
};

/** Average of the detected shots; calibration-style endpoints. */
async function measure(joints, view, h, extra = {}) {
  const shots = [];
  for (const seed of seeds) {
    const r = await shoot({
      joints,
      view,
      hand: h,
      seed,
      ...shotNoise,
      ...extra,
    });
    inference.push(r.inferenceMs);
    shots.push(r);
  }
  const detected = shots.filter((s) => s.detected);
  return {
    detection: detected.length / shots.length,
    flex: detected.length
      ? Object.fromEntries(
          FINGERS.map((f) => [f, mean(detected.map((s) => s.flex[f]))]),
        )
      : null,
    flexStd: detected.length
      ? Object.fromEntries(
          FINGERS.map((f) => [f, std(detected.map((s) => s.flex[f]))]),
        )
      : null,
    shots: detected,
  };
}
const closureOf = (flex, cal, f) =>
  (flex[f] - cal.open[f]) / (cal.closed[f] - cal.open[f]);

for (const view of views)
  for (const h of hands) {
    console.error(`sweep ${view} ${h}`);
    const open = await measure(scaled(0), view, h);
    const closed = await measure(scaled(1), view, h);
    if (!open.flex || !closed.flex) {
      report.sweep.push({
        view,
        hand: h,
        error: 'calibration pose not detected',
        open: open.detection,
        closed: closed.detection,
      });
      continue;
    }
    const cal = { open: open.flex, closed: closed.flex };
    const rows = [];
    for (let s = 0; s <= 1.0001; s += quick ? 0.25 : 0.1) {
      const m = await measure(scaled(s), view, h);
      const errors = m.shots.flatMap((shot) =>
        FINGERS.map((f) => closureOf(shot.flex, cal, f) - s),
      );
      rows.push({
        trueClosure: r3(s),
        detection: m.detection,
        closure: m.flex
          ? Object.fromEntries(
              FINGERS.map((f) => [f, r3(closureOf(m.flex, cal, f))]),
            )
          : null,
        meanAbsError: errors.length ? r3(mean(errors.map(Math.abs))) : null,
        maxAbsError: errors.length
          ? r3(Math.max(...errors.map(Math.abs)))
          : null,
      });
    }
    const all = rows.filter((r) => r.closure);
    const monotonic = Object.fromEntries(
      FINGERS.map((f) => [
        f,
        all.every(
          (r, i) => i === 0 || r.closure[f] >= all[i - 1].closure[f] - 0.05,
        ),
      ]),
    );
    const flat = all.flatMap((r) =>
      FINGERS.map((f) => Math.abs(r.closure[f] - r.trueClosure)),
    );
    report.sweep.push({
      view,
      hand: h,
      calibrationRangeDeg: Object.fromEntries(
        FINGERS.map((f) => [f, r3(cal.closed[f] - cal.open[f])]),
      ),
      trueRangeDeg: trueSums(scaled(1)),
      detection: r3(mean(rows.map((r) => r.detection))),
      closureMAE: r3(mean(flat)),
      closureP95: r3(pct(flat, 95)),
      monotonicWithin005: monotonic,
      rows,
    });

    // Library poses: closure vs the true closure, and whether the engine's reach rule would accept them.
    const trueOpen = trueSums(scaled(0));
    const trueClosed = trueSums(scaled(1));
    for (const [pose, def] of Object.entries(POSES)) {
      const joints = hand(def);
      const m = await measure(joints, view, h);
      const truth = Object.fromEntries(
        FINGERS.map((f) => [
          f,
          (sum(joints[f]) - trueOpen[f]) / (trueClosed[f] - trueOpen[f]),
        ]),
      );
      const accept = (closure) =>
        FINGERS.every((f) => {
          const t = TARGETS[pose][f];
          if (t === null) return true;
          const v = Math.min(1, Math.max(0, closure[f]));
          return pose === 'open' ? v <= t + TOLERANCE : v >= t - TOLERANCE;
        });
      const shotsAccepted = m.shots.map((shot) =>
        accept(
          Object.fromEntries(
            FINGERS.map((f) => [f, closureOf(shot.flex, cal, f)]),
          ),
        ),
      );
      report.poses.push({
        view,
        hand: h,
        pose,
        detection: m.detection,
        trueClosure: Object.fromEntries(FINGERS.map((f) => [f, r3(truth[f])])),
        measured: m.flex
          ? Object.fromEntries(
              FINGERS.map((f) => [f, r3(closureOf(m.flex, cal, f))]),
            )
          : null,
        truthAccepted: accept(truth),
        acceptedShare: shotsAccepted.length
          ? r3(shotsAccepted.filter(Boolean).length / shotsAccepted.length)
          : null,
      });
    }

    // Posture variation, using the untilted calibration (the patient moves after calibrating).
    if (h === 'right')
      for (const tilt of [
        { yaw: -25 },
        { yaw: 25 },
        { pitch: -25 },
        { pitch: 25 },
        { roll: -20 },
        { roll: 20 },
      ])
        for (const s of [0, 0.5, 1]) {
          const m = await measure(scaled(s), view, h, { tilt });
          const errors = m.shots.flatMap((shot) =>
            FINGERS.map((f) => closureOf(shot.flex, cal, f) - s),
          );
          report.tilt.push({
            view,
            tilt,
            trueClosure: s,
            detection: m.detection,
            meanError: errors.length ? r3(mean(errors)) : null,
            maxAbsError: errors.length
              ? r3(Math.max(...errors.map(Math.abs)))
              : null,
          });
        }
  }

// Static jitter in VIDEO mode: a still hand, webcam sensor noise and sub-pixel camera shake per frame.
for (const view of views)
  for (const s of [0, 0.6, 1]) {
    console.error(`jitter ${view} ${s}`);
    await page.evaluate(() => window.bench.resetVideo('CPU'));
    const frames = [];
    const n = quick ? 30 : 90;
    for (let i = 0; i < n; i++)
      frames.push(
        await shoot({
          joints: scaled(s),
          view,
          hand: 'right',
          seed: 100 + i,
          sensorNoise: 6,
          shiftPx: 0.6,
          videoMs: i * 33.3,
        }),
      );
    const seen = frames.filter((f) => f.detected);
    const centered = seen.map((f) => {
      const c = [0, 1, 2].map((k) => mean(f.world.map((p) => p[k])));
      return f.world.map((p) => p.map((v, k) => v - c[k]));
    });
    const axisStd = (k) =>
      centered.length > 2
        ? mean(
            Array.from({ length: 21 }, (_, j) =>
              std(centered.map((w) => w[j][k])),
            ),
          ) * 1000
        : null;
    report.jitter.push({
      view,
      closure: s,
      frames: n,
      detection: r3(seen.length / n),
      worldStdMm: { x: r3(axisStd(0)), y: r3(axisStd(1)), z: r3(axisStd(2)) },
      flexStdDeg:
        seen.length > 2
          ? Object.fromEntries(
              FINGERS.map((f) => [f, r3(std(seen.map((x) => x.flex[f])))]),
            )
          : null,
    });
  }

report.inferenceMs = {
  p50: r3(pct(inference, 50)),
  p95: r3(pct(inference, 95)),
  samples: inference.length,
};
await browser.close();
await server.close();
const out = resolve(
  here,
  quick ? 'mediapipe-bench.quick.json' : 'mediapipe-bench.result.json',
);
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      sweep: report.sweep.map(
        ({
          view,
          hand: h,
          detection,
          closureMAE,
          closureP95,
          calibrationRangeDeg,
          error,
        }) => ({
          view,
          hand: h,
          detection,
          closureMAE,
          closureP95,
          calibrationRangeDeg,
          error,
        }),
      ),
      poses: report.poses.map(
        (p) =>
          `${p.view} ${p.hand} ${p.pose} det=${p.detection} truthOK=${p.truthAccepted} measuredOK=${p.acceptedShare} m=${JSON.stringify(p.measured)}`,
      ),
      tilt: report.tilt.map(
        (t) =>
          `${t.view} ${JSON.stringify(t.tilt)} s=${t.trueClosure} det=${t.detection} err=${t.meanError} max=${t.maxAbsError}`,
      ),
      jitter: report.jitter,
      inferenceMs: report.inferenceMs,
      out,
    },
    null,
    1,
  ),
);
