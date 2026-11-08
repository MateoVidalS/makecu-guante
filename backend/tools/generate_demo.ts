/** Deterministic, synthetic historical demo artifacts, not a hardware simulation.
 *
 * One patient story across ~6 weeks: three sessions with the earlier closing-assist glove, then
 * the opening glove. Measurements follow the engine's semantics (closure from the camera, tendon
 * pull on the wire, 20 Hz traces, staggered assist starts, sustained holding current) with seeded
 * noise, so every chart, replay and AI summary has something believable to read. Kept independent
 * of the live simulator so historical records stay reproducible when the simulator changes.
 * All inserted sessions and evaluations are flagged is_demo by the seeder.
 */
import type {
  AttemptResult,
  ExercisePhase,
  ExercisePlanItem,
} from "../../frontend/src/contracts/engine";
import type { EvaluationResult } from "../../frontend/src/contracts/evaluation";
import type { TranscriptLine } from "../../frontend/src/contracts/api";
import type {
  CoachDecision,
  FeelingEntry,
} from "../../frontend/src/contracts/therapist";
import {
  GLOVE_FINGERS,
  type GloveFinger,
  pullFromClosure,
  closureFromPull,
} from "../../frontend/src/contracts/glove";
import {
  POSES,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
  OPEN_ASSIST_PLAN,
  MAX_ASSIST_PULL,
} from "../../frontend/src/contracts/poses";
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type Calibration,
  type AssistDirection,
} from "../../frontend/src/contracts/calibration";
import { summarizeSession } from "../../frontend/src/engine/metrics";
import calibrationFixture from "../../contracts/fixtures/calibration.json";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const HZ = 20;
const FOLLOW_SLACK = 0.08;
const V_RELEASE = 3;
const V_FOLLOW = 1.5;
const LIMIT_MA = 1500;
const SETTINGS = DEFAULT_EXERCISE_SETTINGS;
const OPEN_SPEED = 0.2;
type Quint = [number, number, number, number, number];
const F = GLOVE_FINGERS;
const NAME: Record<GloveFinger, string> = {
  thumb: "thumb",
  index: "index finger",
  middle: "middle finger",
  ring: "ring finger",
  pinky: "little finger",
};

export const DEMO_PROFILE = {
  pseudonym: "M.R. (demo patient)",
  affected_hand: "right",
  condition:
    "Left-hemisphere ischemic stroke in late May 2026 (about 5 months ago). Right hand: makes an active fist but struggles to open against moderate flexor tone; ring and little finger weakest, thumb opens slowly. Right-handed. Home practice with memo since early October; the first three sessions used the earlier closing-assist glove.",
  goals:
    "Open the right hand wide enough to grasp and release a cup without help. Let go of a light shopping bag. Type short messages with both hands.",
  therapist_name: "L. Okafor, OT (demo therapist)",
  therapist_email: "therapist@example.com",
} as const;

/** Deterministic PRNG (mulberry32) and a Gaussian from it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (sd = 1) => {
    const u = Math.max(1e-9, next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()) * sd;
  };
  return { next, gauss };
}

const iso = (ms: number) => new Date(Math.round(ms)).toISOString();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
/** Smooth 0→1 over [0, 1]. */
const ease = (x: number) => {
  const s = clamp01(x);
  return s * s * (3 - 2 * s);
};
/** Move `from` toward `to` by at most `rate * dt`. */
const ramp = (from: number, to: number, rate: number, dt: number) =>
  from + clamp(to - from, -rate * dt, rate * dt);

// ---------------------------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------------------------

type Kind = "full" | "short4" | "short6" | "brake";
interface Visit {
  daysAgo: number;
  hour: number; // UTC; the patient practices mornings and evenings (UTC−3)
  kind: Kind;
  direction: AssistDirection;
  note?: "cold" | "tired" | "rigid";
}

const OPEN_DAY0 = 35; // the opening glove was fitted and calibrated this many days before the end
const CLOSE_CALIBRATION_DAY = 41;
const COACH_FROM_DAY = 18; // the voice coach was switched on from here
const LEGACY_VISITS: Visit[] = [
  { daysAgo: 41, hour: 13, kind: "full", direction: "close" },
  { daysAgo: 39, hour: 22, kind: "full", direction: "close" },
  { daysAgo: 38, hour: 13, kind: "short4", direction: "close" },
];
const OPEN_VISITS: Visit[] = [
  { daysAgo: 35, hour: 15, kind: "short6", direction: "open" },
  { daysAgo: 34, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 32, hour: 12, kind: "full", direction: "open" },
  { daysAgo: 31, hour: 22, kind: "short4", direction: "open" },
  { daysAgo: 29, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 28, hour: 21, kind: "full", direction: "open" },
  // Days 27–23: a cold, no practice.
  { daysAgo: 22, hour: 14, kind: "short4", direction: "open", note: "rigid" },
  { daysAgo: 21, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 20, hour: 12, kind: "full", direction: "open" },
  { daysAgo: 18, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 17, hour: 22, kind: "short6", direction: "open" },
  { daysAgo: 15, hour: 21, kind: "short4", direction: "open", note: "tired" },
  { daysAgo: 13, hour: 13, kind: "full", direction: "open", note: "tired" },
  { daysAgo: 12, hour: 21, kind: "brake", direction: "open", note: "tired" },
  { daysAgo: 10, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 9, hour: 12, kind: "full", direction: "open" },
  { daysAgo: 7, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 6, hour: 22, kind: "short6", direction: "open" },
  { daysAgo: 4, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 3, hour: 12, kind: "full", direction: "open" },
  { daysAgo: 2, hour: 13, kind: "full", direction: "open" },
  { daysAgo: 1, hour: 13, kind: "full", direction: "open" },
];
export const EVALUATION_DAYS = [35, 28, 20, 13, 2];
const PLAN_ITEMS: Record<Kind, number> = {
  full: 10,
  short4: 4,
  short6: 6,
  brake: 10,
};
/** In the brake session, pain stops this attempt (the 4th open try) and the session ends. */
const BRAKE_AT = 7;

/** Progress through the opening-glove weeks, 0 at the first fitting and 1 yesterday. */
const progressOf = (daysAgo: number) =>
  clamp01((OPEN_DAY0 - daysAgo) / (OPEN_DAY0 - 1));

/**
 * Closure each finger reaches alone on an open attempt (lower = opens further). Index improves
 * most, middle and ring steadily, thumb slowly, and the little finger plateaus after week three.
 */
function aloneClosure(daysAgo: number, note?: Visit["note"]): Quint {
  const p = progressOf(daysAgo);
  const sat = (k: number) => (1 - Math.exp(-k * p)) / (1 - Math.exp(-k));
  const start: Quint = [0.62, 0.68, 0.71, 0.77, 0.81];
  const end: Quint = [0.47, 0.24, 0.33, 0.47, 0.63];
  const shape: Quint = [
    p,
    sat(2.4),
    sat(1.8),
    sat(1.5),
    ease(Math.min(1, p / 0.6)),
  ];
  const base = start.map((s, i) => s + (end[i] - s) * shape[i]) as Quint;
  if (note === "cold" || note === "rigid")
    return base.map((c) => c + 0.06) as Quint;
  if (note === "tired")
    return base.map((c, i) => c + (i === 3 ? 0.09 : 0.03)) as Quint;
  return base;
}

/** Relaxed posture after a fist (the patient's flexor tone curls the fingers back). */
function restClosure(daysAgo: number): Quint {
  const p = progressOf(daysAgo);
  return [0.56, 0.8, 0.83, 0.86, 0.88].map((c) => c - 0.05 * p) as Quint;
}

/** Holding current per unit of stretch beyond rest: flexor tone eases a little over the weeks. */
function toneMa(daysAgo: number): Quint {
  const p = progressOf(daysAgo);
  return [210, 240, 255, 290, 315].map((t, i) =>
    Math.round(t * (1 - (0.18 + 0.02 * i) * p)),
  ) as Quint;
}

// ---------------------------------------------------------------------------------------------
// Attempts and traces
// ---------------------------------------------------------------------------------------------

interface TraceSample {
  phase: ExercisePhase;
  closure: Quint;
  pull: Quint;
  ma: number;
}

function emptyTrace(): AttemptResult["trace"] {
  return {
    hz: HZ,
    t: [],
    closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
    servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
    ma: [],
    phase: [],
  };
}

function pushSample(trace: AttemptResult["trace"], s: TraceSample) {
  trace.t.push(r3(trace.t.length / HZ));
  trace.phase.push(s.phase);
  F.forEach((f, i) => {
    trace.closure[f].push(r3(clamp01(s.closure[i])));
    trace.servo[f].push(r3(clamp01(s.pull[i])));
  });
  trace.ma.push(Math.round(s.ma));
}

interface AttemptContext {
  start: number;
  index: number;
  rep: number;
  daysAgo: number;
  direction: AssistDirection;
  note?: Visit["note"];
  openRep: number; // nth open (or legacy fist) attempt in this session, 0-based
  fatigue: number; // 0..1 within-session tiredness
  rand: ReturnType<typeof rng>;
  /** Ring target shaped by the coach (closure the patient is asked to reach). */
  targets?: Partial<Record<GloveFinger, number>>;
  rigidIndex?: boolean;
  brakeAt?: number; // seconds into ASSIST when pain stops the attempt
}

/** Base motor current: electronics, holding servos at rest, and sensor noise. */
const idleMa = (rand: AttemptContext["rand"]) => 88 + rand.gauss(4);

/** An independent fist with the opening glove: the glove only pays out the thread. */
function fistAttempt(ctx: AttemptContext): AttemptResult {
  const { rand } = ctx;
  const p = progressOf(ctx.daysAgo);
  const target = F.map((f) => POSES.full_fist.closure[f]!) as Quint;
  const tiredness = (ctx.note === "tired" ? 0.03 : 0) + 0.02 * ctx.fatigue;
  const best = target.map((c, i) =>
    clamp(
      c - Math.abs(0.012 + tiredness + (i >= 3 ? 0.01 : 0) + rand.gauss(0.012)),
      0.55,
      1,
    ),
  ) as Quint;
  const reach = clamp(3.4 - 1.2 * p + 0.6 * ctx.fatigue + rand.gauss(0.25), 1.8, 5.2);
  const startOpen = F.map((_, i) => 0.18 + (i === 0 ? 0.08 : 0) + rand.gauss(0.02));
  const trace = emptyTrace();
  const phases: [ExercisePhase, number][] = [
    ["PRESENT", SETTINGS.present_s],
    ["ATTEMPT", reach + SETTINGS.reach_dwell_s],
    ["HOLD", SETTINGS.hold_s],
    ["RELEASE", 1],
  ];
  let pull = startOpen.map((c) => Math.max(0, pullFromClosure(c) - FOLLOW_SLACK)) as Quint;
  let closure = [...startOpen] as Quint;
  let t = 0;
  const lag = F.map((_, i) => 0.15 * i + rand.gauss(0.05));
  for (const [phase, seconds] of phases) {
    const t0 = t;
    for (let k = 0; k < Math.round(seconds * HZ); k++, t += 1 / HZ) {
      const u = t - t0;
      closure = F.map((_, i) => {
        if (phase === "PRESENT") return startOpen[i] + rand.gauss(0.004);
        if (phase === "ATTEMPT")
          return (
            startOpen[i] +
            (best[i] - startOpen[i]) * ease((u - lag[i]) / Math.max(0.8, reach - 0.3)) +
            rand.gauss(0.006)
          );
        if (phase === "HOLD") return best[i] - 0.01 * u + rand.gauss(0.006);
        return best[i] - (best[i] - 0.82) * ease(u) + rand.gauss(0.006);
      }) as Quint;
      // Follow: the thread pays out at V_RELEASE so the glove never blocks a fist.
      pull = pull.map((a, i) =>
        ramp(a, Math.max(0, pullFromClosure(closure[i]) - FOLLOW_SLACK), V_RELEASE, 1 / HZ),
      ) as Quint;
      if (phase === "RELEASE") pull = pull.map((a) => ramp(a, 0, V_RELEASE, 1 / HZ)) as Quint;
      const moving = phase === "ATTEMPT" && u < reach ? 55 : 0;
      pushSample(trace, { phase, closure, pull, ma: idleMa(rand) + moving + rand.gauss(6) });
    }
  }
  // The final sample always reports a slack thread (release ends at pull 0).
  F.forEach((f) => (trace.servo[f][trace.servo[f].length - 1] = 0));
  const duration = trace.t.length / HZ;
  return {
    pose: "full_fist",
    rep: ctx.rep,
    index: ctx.index,
    started_at: iso(ctx.start),
    ended_at: iso(ctx.start + duration * 1000),
    reached_active: true,
    reached_final: true,
    assisted: false,
    time_to_position_s: r1(reach),
    active_ratio: r3(mean(best.map((c, i) => clamp01(c / target[i])))),
    fingers: F.map((finger, i) => ({
      finger,
      scored: true,
      target: target[i],
      active_max: r3(best[i]),
      assist_needed: 0,
      final: r3(best[i] - 0.01),
    })),
    pinch_min: null,
    current_peak_ma: null,
    current_mean_ma: null,
    safety_events: [],
    interrupted: false,
    trace,
  };
}

/**
 * An open attempt: the patient opens alone during ATTEMPT (the glove follows with slack), then the
 * glove winds each finger that is still short, staggered 150 ms apart, at the assist speed, and
 * holds it open against flexor tone.
 */
function openAttempt(ctx: AttemptContext): AttemptResult {
  const { rand } = ctx;
  const target = F.map((f) => ctx.targets?.[f] ?? POSES.open.closure[f]!) as Quint;
  const rest = restClosure(ctx.daysAgo).map((c) => c + rand.gauss(0.015)) as Quint;
  const warmup = ctx.openRep === 0 ? 0.015 : 0;
  const alone = aloneClosure(ctx.daysAgo, ctx.note).map((c, i) =>
    clamp(c + warmup + 0.035 * ctx.fatigue + (i === 4 ? 0.01 * ctx.openRep : 0) + rand.gauss(0.018), 0.12, rest[i] - 0.04),
  ) as Quint;
  const tone = toneMa(ctx.daysAgo);
  const residual = F.map((_, i) => clamp(0.035 + 0.012 * i + 0.02 * ctx.fatigue + rand.gauss(0.01), 0.02, 0.12));
  const rigidFloor = ctx.rigidIndex ? 0.5 : null;
  // A rigid finger cannot pass its floor on its own either; the glove stalls just past it.
  if (rigidFloor !== null) alone[1] = Math.max(alone[1], rigidFloor + 0.07);
  const goal = target.map((c) => Math.min(MAX_ASSIST_PULL, pullFromClosure(c))) as Quint;
  // Plateau: the attempt ends 2 s after the patient stops opening, at most attempt_s.
  const opening = clamp(2.2 + rand.gauss(0.35) + 0.4 * ctx.fatigue, 1.5, 3.8);
  const attemptS = Math.min(SETTINGS.attempt_s, opening + SETTINGS.plateau_s);
  const order = F.map((_, i) => i).sort((a, b) => alone[b] - target[b] - (alone[a] - target[a]));
  const startDelay: number[] = [];
  order.forEach((finger, k) => (startDelay[finger] = 0.15 * k));
  const trace = emptyTrace();
  const currents: number[] = [];
  const safety: AttemptResult["safety_events"] = [];
  let closure = [...rest] as Quint;
  let pull = rest.map((c) => Math.max(0, pullFromClosure(c) - FOLLOW_SLACK)) as Quint;
  let frozen: number | null = null; // index pull frozen by resistance
  let t = 0;
  const step = (phase: ExercisePhase, u: number, assistU: number | null) => {
    const prev = closure;
    // Patient's own closure: opens toward `alone`, tone drifts it back a little while waiting.
    const own = F.map((_, i) => {
      if (phase === "PRESENT") return rest[i];
      const openU = phase === "ATTEMPT" ? u : attemptS + (assistU ?? 0);
      const reached = rest[i] + (alone[i] - rest[i]) * ease(openU / opening);
      return reached + (openU > opening ? 0.012 * Math.min(1, (openU - opening) / 2) : 0);
    });
    if (phase === "ATTEMPT" || phase === "PRESENT") {
      pull = pull.map((a, i) =>
        ramp(a, Math.max(0, pullFromClosure(own[i]) - FOLLOW_SLACK), own[i] < prev[i] ? V_FOLLOW : V_RELEASE, 1 / HZ),
      ) as Quint;
    } else if (phase === "ASSIST" || phase === "ASSIST_HOLD") {
      pull = pull.map((a, i) => {
        if (i === 1 && frozen !== null) return frozen;
        if (assistU! < startDelay[i]) return a;
        return ramp(a, goal[i], OPEN_SPEED, 1 / HZ);
      }) as Quint;
    } else {
      pull = pull.map((a) => ramp(a, 0, V_RELEASE, 1 / HZ)) as Quint;
    }
    closure = F.map((_, i) => {
      if (phase === "RELEASE") return prev[i] + (rest[i] - prev[i]) * Math.min(1, 4 / HZ);
      // The glove can only reduce closure; tendon stretch leaves a small residual bend.
      let c = Math.min(own[i], closureFromPull(pull[i]) + residual[i] * pull[i]);
      if (i === 1 && rigidFloor !== null) c = Math.max(rigidFloor, c);
      return c + rand.gauss(0.005);
    }) as Quint;
    // Current: idle + winding servos + sustained holding against flexor tone.
    let ma = idleMa(rand);
    F.forEach((_, i) => {
      const stretch = Math.max(0, rest[i] - closure[i] - Math.max(0, rest[i] - own[i]));
      const winding = Math.abs(pull[i] - (trace.servo[F[i]].at(-1) ?? pull[i])) > 0.002;
      ma += (winding ? 48 : 0) + (phase.startsWith("ASSIST") ? tone[i] * stretch : 0);
      if (i === 1 && rigidFloor !== null && phase === "ASSIST" && pull[i] > 1 - rigidFloor)
        ma += 900 * (pull[i] - (1 - rigidFloor));
    });
    ma += rand.gauss(9);
    if (phase.startsWith("ASSIST")) currents.push(ma);
    pushSample(trace, { phase, closure, pull, ma });
    return ma;
  };
  for (let k = 0; k < SETTINGS.present_s * HZ; k++, t += 1 / HZ) step("PRESENT", k / HZ, null);
  for (let k = 0; k < Math.round(attemptS * HZ); k++, t += 1 / HZ) step("ATTEMPT", k / HZ, null);
  // ASSIST until every started finger is within 0.02 of its goal for 1 s (or resistance/brake).
  let settledFor = 0;
  let assistU = 0;
  let interrupted = false;
  while (assistU < SETTINGS.assist_max_s) {
    const ma = step("ASSIST", assistU, assistU);
    // Resistance: the index stopped following while its pull kept rising (current high, no motion).
    if (ctx.rigidIndex && frozen === null && pull[1] > 1 - rigidFloor! + 0.18) {
      frozen = pull[1];
      safety.push({ source: "resistance", finger: "index", ma: Math.round(ma), t_rel: r3(t) });
    }
    if (ctx.brakeAt !== undefined && assistU >= ctx.brakeAt) {
      safety.push({ source: "coach_brake", finger: null, ma: null, t_rel: r3(t) });
      interrupted = true;
      break;
    }
    const settled = F.every((_, i) => (i === 1 && frozen !== null) || Math.abs(pull[i] - goal[i]) <= 0.02);
    settledFor = settled ? settledFor + 1 / HZ : 0;
    assistU += 1 / HZ;
    t += 1 / HZ;
    if (settledFor >= 1) break;
  }
  if (interrupted) {
    for (let k = 0; k < HZ; k++, t += 1 / HZ) step("PAUSED", k / HZ, null);
  } else {
    for (let k = 0; k < SETTINGS.hold_s * HZ; k++, t += 1 / HZ, assistU += 1 / HZ)
      step("ASSIST_HOLD", assistU, assistU);
    for (let k = 0; k < HZ; k++, t += 1 / HZ) step("RELEASE", k / HZ, null);
  }
  F.forEach((f) => (trace.servo[f][trace.servo[f].length - 1] = 0));
  const holdEnd = trace.phase.lastIndexOf(interrupted ? "ASSIST" : "ASSIST_HOLD");
  const final = F.map((f) => trace.closure[f][holdEnd]!) as Quint;
  const tolerance = SETTINGS.tolerance;
  const reachedFinal =
    !interrupted &&
    final.every((c, i) => c <= Math.max(target[i], closureFromPull(MAX_ASSIST_PULL)) + tolerance);
  const duration = trace.t.length / HZ;
  return {
    pose: "open",
    rep: ctx.rep,
    index: ctx.index,
    started_at: iso(ctx.start),
    ended_at: iso(ctx.start + duration * 1000),
    reached_active: false,
    reached_final: reachedFinal,
    assisted: true,
    time_to_position_s: null,
    active_ratio: r3(mean(alone.map((c) => pullFromClosure(c)))),
    fingers: F.map((finger, i) => ({
      finger,
      scored: true,
      target: target[i],
      active_max: r3(alone[i]),
      assist_needed: r3(Math.max(0, alone[i] > target[i] + tolerance ? alone[i] - target[i] : 0)),
      final: r3(final[i]),
    })),
    pinch_min: null,
    current_peak_ma: Math.round(Math.max(...currents)),
    current_mean_ma: Math.round(mean(currents)),
    safety_events: safety,
    interrupted,
    trace,
  };
}

/** Earlier closing-assist glove: the patient closes part-way and the glove completes the fist. */
function legacyFistAttempt(ctx: AttemptContext): AttemptResult {
  const { rand } = ctx;
  const target = F.map((f) => POSES.full_fist.closure[f]!) as Quint;
  const alone = target.map((c, i) => clamp(c * (0.5 + 0.03 * (3 - i)) + rand.gauss(0.03), 0.25, c - 0.15)) as Quint;
  const trace = emptyTrace();
  const currents: number[] = [];
  let closure = F.map(() => 0.18) as Quint;
  let pull = closure.map((c) => Math.max(0, c - FOLLOW_SLACK)) as Quint;
  const attemptS = 4 + rand.gauss(0.3);
  const plan: [ExercisePhase, number][] = [
    ["PRESENT", SETTINGS.present_s],
    ["ATTEMPT", attemptS],
    ["ASSIST", 3.5],
    ["ASSIST_HOLD", SETTINGS.hold_s],
    ["RELEASE", 1],
  ];
  for (const [phase, seconds] of plan) {
    for (let k = 0; k < Math.round(seconds * HZ); k++) {
      const u = k / HZ;
      if (phase === "ATTEMPT")
        closure = F.map((_, i) => 0.18 + (alone[i] - 0.18) * ease(u / 2.2) + rand.gauss(0.005)) as Quint;
      if (phase === "ATTEMPT" || phase === "PRESENT")
        pull = pull.map((a, i) => ramp(a, Math.max(0, closure[i] - FOLLOW_SLACK), V_FOLLOW, 1 / HZ)) as Quint;
      if (phase.startsWith("ASSIST")) {
        pull = pull.map((a, i) => ramp(a, target[i], 0.3, 1 / HZ)) as Quint;
        closure = F.map((_, i) => Math.max(alone[i], pull[i] - 0.03) + rand.gauss(0.005)) as Quint;
      }
      if (phase === "RELEASE") {
        pull = pull.map((a) => ramp(a, 0, V_RELEASE, 1 / HZ)) as Quint;
        closure = closure.map((c) => c + (0.2 - c) * (4 / HZ)) as Quint;
      }
      const winding = phase === "ASSIST" && u < 3 ? 160 : 0;
      const ma = idleMa(rand) + winding + (phase.startsWith("ASSIST") ? 240 : 0) + rand.gauss(10);
      if (phase.startsWith("ASSIST")) currents.push(ma);
      pushSample(trace, { phase, closure, pull, ma });
    }
  }
  F.forEach((f) => (trace.servo[f][trace.servo[f].length - 1] = 0));
  const holdEnd = trace.phase.lastIndexOf("ASSIST_HOLD");
  const duration = trace.t.length / HZ;
  return {
    pose: "full_fist",
    rep: ctx.rep,
    index: ctx.index,
    started_at: iso(ctx.start),
    ended_at: iso(ctx.start + duration * 1000),
    reached_active: false,
    reached_final: true,
    assisted: true,
    time_to_position_s: null,
    active_ratio: r3(mean(alone.map((c, i) => c / target[i]))),
    fingers: F.map((finger, i) => ({
      finger,
      scored: true,
      target: target[i],
      active_max: r3(alone[i]),
      assist_needed: r3(target[i] - alone[i]),
      final: r3(trace.closure[finger][holdEnd]!),
    })),
    pinch_min: null,
    current_peak_ma: Math.round(Math.max(...currents)),
    current_mean_ma: Math.round(mean(currents)),
    safety_events: [],
    interrupted: false,
    trace,
  };
}

// ---------------------------------------------------------------------------------------------
// Coach, feelings and transcript
// ---------------------------------------------------------------------------------------------

interface CoachRecords {
  decisions: CoachDecision[];
  feelings: FeelingEntry[];
  transcript: TranscriptLine[];
}

const FEELING_NOTES = {
  good: [
    "Hand feels looser after a warm shower.",
    "Opening is easier today.",
    "Index opens almost by itself now.",
    "Feels good, a bit tired in the forearm.",
    "Easier than last week.",
  ],
  pinky: [
    "Little finger still feels stuck.",
    "The little finger needs the glove the most.",
    "Little finger pulls back when I let go.",
  ],
  tired: [
    "Slept badly, hand feels heavy.",
    "Ring finger feels stiff tonight.",
    "Tired after work.",
  ],
} as const;

function laggingFinger(attempts: AttemptResult[]): GloveFinger {
  const open = attempts.filter((a) => a.pose === "open");
  const deficits = F.map((f) => mean(open.map((a) => a.fingers.find((x) => x.finger === f)!.active_max!)));
  return F[deficits.indexOf(Math.max(...deficits))];
}

function coachFor(
  visit: Visit,
  visitIndex: number,
  attempts: AttemptResult[],
  rand: ReturnType<typeof rng>,
): CoachRecords {
  const decisions: CoachDecision[] = [];
  const feelings: FeelingEntry[] = [];
  const transcript: TranscriptLine[] = [];
  const at = (a: AttemptResult, seconds: number) => iso(Date.parse(a.started_at) + seconds * 1000);
  const after = (a: AttemptResult, seconds: number) => iso(Date.parse(a.ended_at) + seconds * 1000);
  let n = 0;
  const decide = (
    t: string,
    tool: string,
    requested: Record<string, unknown>,
    applied: Record<string, unknown> | null,
    result: CoachDecision["result"],
    reason: string,
    source: CoachDecision["source"] = "coach",
  ) =>
    decisions.push({ id: `demo-${visitIndex}-${n++}`, t, session_id: null, tool, requested, applied, result, reason, source });
  const say = (t: string, role: TranscriptLine["role"], text: string) => transcript.push({ t, role, text });
  const feel = (a: AttemptResult, pain: number, fatigue: number, note: string, source: FeelingEntry["source"] = "voice") =>
    feelings.push({ t: after(a, 1), session_id: 0, attempt_index: a.index, pain, fatigue, note, source });

  const coached = visit.daysAgo <= COACH_FROM_DAY;
  const tired = visit.note === "tired";
  const lag = laggingFinger(attempts);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand.next() * list.length)];

  if (!coached) {
    // Before the voice coach: an occasional check-in from the patient button.
    if (visit.daysAgo === 28 || visit.daysAgo === 31) {
      const a = attempts.at(-1)!;
      feel(a, 1, visit.daysAgo === 28 ? 6 : 4, visit.daysAgo === 28 ? "Long day at work." : "Forearm tired.", "ui");
    }
    return { decisions, feelings, transcript };
  }

  const first = attempts[0];
  say(at(first, 0.5), "coach", visit.daysAgo === COACH_FROM_DAY
    ? "Hi, I'm your practice coach. We'll make a fist, then open your hand. The glove only helps where you need it."
    : pick([
        "Welcome back. Fist first, then we open together.",
        "Good to see you. Let's start with a relaxed fist.",
        "Hello again. Ten tries today: fist, then open.",
      ]));
  say(at(first, 2.5), "patient", pick(["Okay, ready.", "Ready.", "Let's go."]));

  const opens = attempts.filter((a) => a.pose === "open");
  const fatigueBase = tired ? 4 : 2;
  opens.forEach((a, k) => {
    const finger = a.fingers.find((x) => x.finger === lag)!;
    say(at(a, 3.2), "coach", k === 0
      ? "Now open your hand as wide as you can."
      : pick(["Open wide. Spread your fingers.", "Open your hand. Push the fingers straight.", "Your turn: open as far as you can."]));
    if (k === 1) {
      decide(at(a, 3.4), "highlight_finger", { finger: lag, reason: `Focus on opening your ${NAME[lag]}.` }, { finger: lag }, "applied", `Focus on opening your ${NAME[lag]}.`);
      say(at(a, 3.5), "coach", `Think about your ${NAME[lag]}. Let it lead.`);
    }
    if (a.interrupted) return;
    say(at(a, 9.5), "coach", finger.active_max! < 0.5
      ? pick(["Nice opening on your own. I'm finishing the rest.", "Good, you did most of that. I'll help the last part."])
      : pick(["I'll help you open the rest now. Slow and steady.", "Keep relaxing. I'm helping your fingers straighten."]));
  });

  // Check-ins after the 2nd and 4th open attempts, and at the end.
  const checkpoints = [opens[1], opens[3], opens.at(-1)].filter((a, i, list) => a && list.indexOf(a) === i) as AttemptResult[];
  checkpoints.forEach((a, k) => {
    if (a.interrupted) return;
    const pain = tired ? (k === 0 ? 1 : 2) : rand.next() < 0.75 ? 0 : 1;
    const fatigue = Math.min(8, fatigueBase + k + (rand.next() < 0.3 ? 1 : 0));
    const note = tired ? pick(FEELING_NOTES.tired) : lag === "pinky" && k === 1 ? pick(FEELING_NOTES.pinky) : pick(FEELING_NOTES.good);
    say(after(a, 0.3), "coach", "Quick check: any pain, from zero to ten? And how tired is your hand?");
    say(after(a, 0.8), "patient", `${pain === 0 ? "No pain." : `Pain about ${pain}.`} Tiredness ${fatigue}. ${note}`);
    feel(a, pain, fatigue, note);
    if (fatigue >= 5 && k < checkpoints.length - 1) {
      decide(after(a, 1.4), "add_rest", { seconds: 15, reason: "A short rest before the next try." }, { seconds: 15, extra_rest_s: 15, applies: "next REST" }, "applied", "Fatigue 5/10: a short rest before the next try.");
      say(after(a, 1.6), "coach", "Let's take fifteen extra seconds of rest.");
    }
  });

  // Session-specific moments that give the therapist something to read.
  const d = visit.daysAgo;
  if (d === 15 || d === 13) {
    const a = d === 15 ? opens[0] : opens[1];
    decide(after(a, 2.2), "adjust_target", { finger: "ring", direction: "lower", reason: "Ring finger is tired tonight; aim a little less open." }, { finger: "ring", target_scale: 0.9, applies: "next ATTEMPT" }, "applied", "Ring finger tired: target eased for the next tries.");
    say(after(a, 2.4), "coach", "Your ring finger is tired tonight, so I'll ask it to open a little less.");
  }
  if (d === 13) {
    const a = opens[2];
    decide(after(a, 2.0), "adjust_help", { finger: "pinky", direction: "gentler", reason: "Little finger felt a strong pull." }, {
      assist_speed: { thumb: 0.2, index: 0.2, middle: 0.2, ring: 0.2, pinky: 0.15 },
      assist_delay_s: { thumb: 6, index: 6, middle: 6, ring: 6, pinky: 6 },
      applies: "immediately",
    }, "applied", "Gentler help on the little finger after the patient felt a strong pull.");
    say(after(a, 1.2), "patient", "The little finger pulled a bit hard.");
    say(after(a, 2.2), "coach", "Thanks for telling me. I'll open your little finger more gently.");
  }
  if (d === 12) {
    const a = attempts.find((x) => x.interrupted)!;
    const t = iso(Date.parse(a.started_at) + (a.safety_events[0]!.t_rel - 0.4) * 1000);
    say(t, "patient", "Ow, that pulls in my ring finger.");
    feelings.push({ t, session_id: 0, attempt_index: a.index, pain: 4, fatigue: 6, note: "Sharp pull in the ring finger while opening.", source: "voice" });
    decide(iso(Date.parse(t) + 300), "brake", { reason: "Pain 4/10 reported" }, { phase: "PAUSED", safety_source: "coach_brake" }, "applied", "Pain 4/10 reported: glove released and practice paused.", "local_rule");
    say(iso(Date.parse(t) + 500), "coach", "I've released the glove. Rest your hand. We'll stop here for tonight.");
    decide(iso(Date.parse(t) + 20_000), "stop_session", { reason: "Patient chose to stop after the pain report." }, { ended: true }, "applied", "Patient chose to stop after the pain report.", "patient_ui");
    decide(iso(Date.parse(t) + 21_000), "note_for_therapist", { text: "Sharp pull in the ring finger at about 70% opening on the 4th open try, pain 4/10. Stopped. Settled within a minute." }, { text: "Sharp pull in the ring finger at about 70% opening on the 4th open try, pain 4/10. Stopped. Settled within a minute." }, "applied", "Pain report saved for the therapist.");
  }
  if (d === 9) {
    const a = opens[1];
    decide(after(a, 2.0), "set_attempt_time", { seconds: 8, reason: "More time to open alone." }, { seconds: 8, applies: "next ATTEMPT" }, "applied", "More time to open alone before the glove helps.");
    decide(after(a, 9.0), "undo_last_adjustment", {}, { undone: "set_attempt_time" }, "applied", "Patient preferred the usual try time.", "patient_ui");
    say(after(a, 8.5), "patient", "Actually, the normal time is fine.");
  }
  if (d === 4) {
    const a = opens[2];
    decide(after(a, 1.5), "intensify", { finger: "index", kind: "faster", consent: true, patient_quote: "Can it go faster?" }, null, "rejected", "Faster opening stretches tight muscles; help stays at the gentle speed today.");
    say(after(a, 1.0), "patient", "Can it go faster?");
    say(after(a, 1.8), "coach", "Opening fast can make tight muscles pull back, so we'll keep it gentle.");
  }
  if (d === 3) {
    const a = opens[1];
    decide(after(a, 1.5), "intensify", { finger: "index", kind: "further", consent: true, patient_quote: "Let's try to open it all the way." }, {
      finger: "index", kind: "further", consent: true, patient_quote: "Let's try to open it all the way.",
      assist_speed: 0.2, target_max: 1, hold_extra_s: 0, intensified: ["index"], applies: "next ATTEMPT",
    }, "applied", "Patient asked to open the index fully.");
    say(after(a, 1.0), "patient", "Let's try to open it all the way.");
    say(after(a, 1.8), "coach", "Okay. Next time I'll open your index all the way, still slowly.");
  }
  if (d === 7) {
    const a = opens.at(-1)!;
    decide(after(a, 3.0), "note_for_therapist", { text: "Little finger opening has not changed for about two weeks; it curls back as soon as the glove releases." }, { text: "Little finger opening has not changed for about two weeks; it curls back as soon as the glove releases." }, "applied", "Plateau noted for the therapist.");
  }
  const last = attempts.at(-1)!;
  if (!last.interrupted)
    say(after(last, 2), "coach", pick([
      "Great work today. Your index opened further than last week.",
      "That's the session. Well done, rest your hand now.",
      "All done. Thanks for the effort today.",
    ]));
  decisions.sort((a, b) => a.t.localeCompare(b.t));
  feelings.sort((a, b) => a.t.localeCompare(b.t));
  transcript.sort((a, b) => a.t.localeCompare(b.t));
  return { decisions, feelings, transcript };
}

// ---------------------------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------------------------

/** Flexor resistance to opening rises with pull and with stretch speed; it eases over the weeks. */
function evaluation(start: number, daysAgo: number, seed: number): EvaluationResult {
  const rand = rng(seed);
  const p = progressOf(daysAgo);
  const friction = (pos: number, v: number) => 82 + 26 * pos + (v > 0.5 ? 9 : 0);
  const sweeps = F.flatMap((finger, i) =>
    (["slow", "fast"] as const).map((speed) => {
      const v = speed === "slow" ? DEFAULT_EVAL_SETTINGS.slow_v : DEFAULT_EVAL_SETTINGS.fast_v;
      // Little finger eases least; index most.
      const ease_ = [0.2, 0.32, 0.27, 0.24, 0.12][i];
      const tone = [190, 215, 235, 265, 290][i] * (1 - ease_ * p);
      const velocity = [95, 110, 120, 140, 165][i] * (1 - (ease_ + 0.06) * p);
      const onset = 0.12 + 0.02 * i;
      const points = Array.from({ length: 20 }, (_, n) => {
        const pos = r3(n * 0.05);
        const stretch = Math.max(0, pos - onset) / (1 - onset);
        const excess = Math.max(0, (tone + velocity * v) * stretch ** 1.25 * 0.82 + rand.gauss(5));
        return { pos, excess_ma: Math.round(excess), ma: Math.round(friction(pos, v) + excess + rand.gauss(3)) };
      });
      return { finger, speed, v, points, aborted_at: null };
    }),
  );
  return {
    started_at: iso(start),
    ended_at: iso(start + 140_000),
    settings: DEFAULT_EVAL_SETTINGS,
    friction_used: true,
    sweeps,
    fingers: F.map((finger) => {
      const group = sweeps.filter((s) => s.finger === finger);
      const resistance = group.map((s) => mean(s.points.filter((x) => x.pos >= 0.2 && x.pos <= 0.9).map((x) => x.excess_ma)));
      return {
        finger,
        resistance_slow_ma: r1(resistance[0]),
        resistance_fast_ma: r1(resistance[1]),
        velocity_dependence_ma: r1(resistance[1] - resistance[0]),
        peak_excess_ma: Math.max(...group.flatMap((s) => s.points.map((x) => x.excess_ma))),
        aborted: false,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function friction(): Calibration["friction"] {
  return Object.fromEntries(
    F.map((f, i) => [
      f,
      [0.2, 1].map((v) => ({
        v,
        points: [0, 0.25, 0.5, 0.75, 0.95].map((pos) => ({ pos, ma: Math.round(80 + 2 * i + 26 * pos + (v > 0.5 ? 9 : 0)) })),
      })),
    ]),
  ) as Calibration["friction"];
}

function planFor(visit: Visit): ExercisePlanItem[] {
  if (visit.direction === "close") return [{ pose: "full_fist", reps: PLAN_ITEMS[visit.kind] }];
  return OPEN_ASSIST_PLAN.slice(0, PLAN_ITEMS[visit.kind]);
}

export async function generateDemo(end: string) {
  const date = new Date(end);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const calibration = structuredClone(calibrationFixture) as Calibration;
  calibration.assist_direction = "open";
  calibration.created_at = iso(midnight - OPEN_DAY0 * DAY + 14 * HOUR);
  calibration.camera.camera_view = CURRENT_CAMERA_VIEW;
  calibration.camera.flex_model = CURRENT_FLEX_MODEL;
  calibration.friction = friction();
  calibration.current_limit_ma = LIMIT_MA;
  const legacy_calibration = {
    ...structuredClone(calibration),
    created_at: iso(midnight - CLOSE_CALIBRATION_DAY * DAY + 12 * HOUR),
    assist_direction: undefined,
  };
  const visits = [...LEGACY_VISITS, ...OPEN_VISITS];
  const sessions = visits.map((visit, visitIndex) => {
    const rand = rng(1000 + visitIndex * 7919);
    const plan = planFor(visit);
    let clock = midnight - visit.daysAgo * DAY + visit.hour * HOUR + Math.round(rand.next() * 40) * 60_000;
    const attempts: AttemptResult[] = [];
    const total = plan.reduce((n, item) => n + item.reps, 0);
    let openRep = 0;
    // The coach eases the ring target after the 1st (day 15) or 2nd (day 13) open try.
    const ringEasedFrom = visit.daysAgo === 15 ? 1 : visit.daysAgo === 13 ? 2 : Infinity;
    for (const item of plan)
      for (let rep = 0; rep < item.reps; rep++) {
        const index = attempts.length;
        if (visit.kind === "brake" && index > BRAKE_AT) break;
        const ctx: AttemptContext = {
          start: clock,
          index,
          rep: rep + 1,
          daysAgo: visit.daysAgo,
          direction: visit.direction,
          note: visit.note,
          openRep,
          fatigue: index / Math.max(1, total - 1),
          rand,
          targets: openRep >= ringEasedFrom ? { ring: 0.1 } : undefined,
          rigidIndex: visit.note === "rigid" && index === 3,
          brakeAt: visit.kind === "brake" && index === BRAKE_AT ? 2.6 : undefined,
        };
        const a =
          visit.direction === "close"
            ? legacyFistAttempt(ctx)
            : item.pose === "open"
              ? openAttempt(ctx)
              : fistAttempt(ctx);
        if (item.pose === "open" || visit.direction === "close") openRep++;
        attempts.push(a);
        // Rest between attempts (rest_s), plus extra rest the coach added.
        clock = Date.parse(a.ended_at) + (SETTINGS.rest_s + rand.next() * 1.5) * 1000;
      }
    const coach = visit.direction === "open" ? coachFor(visit, visitIndex, attempts, rand) : { decisions: [], feelings: [], transcript: [] };
    const lastEnd = Date.parse(attempts.at(-1)!.ended_at);
    const ended = Math.max(lastEnd, ...coach.decisions.map((x) => Date.parse(x.t)), ...coach.transcript.map((x) => Date.parse(x.t))) + 2000;
    return {
      assist_direction: visit.direction,
      started_at: attempts[0].started_at,
      ended_at: iso(ended),
      plan,
      settings: { ...SETTINGS, assist_speed: visit.direction === "open" ? OPEN_SPEED : SETTINGS.assist_speed },
      attempts,
      summary: summarizeSession(attempts),
      decisions: coach.decisions,
      feelings: coach.feelings,
      transcript: coach.transcript,
    };
  });
  const evaluations = EVALUATION_DAYS.map((day, i) =>
    evaluation(midnight - day * DAY + 12 * HOUR + 20 * 60_000, day, 77 + i),
  );
  return { profile: DEMO_PROFILE, calibration, legacy_calibration, sessions, evaluations };
}
