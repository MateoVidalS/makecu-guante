/**
 * Demo history: four weeks of a believable patient, recorded by running the production
 * exercise and evaluation engines against SimWorld. Nothing below writes a measurement
 * directly; the story is told only through the simulated patient's abilities per session.
 *
 * The patient (see DEMO_PROFILE): five months after a left-hemisphere stroke, right hand.
 * They can start every grip but can't finish it, and the ring and little fingers are the
 * weakest: the profile that assist-as-needed helps most. Over four weeks the index improves
 * most, the middle steadily, the thumb slowly, the little finger plateaus after week two, and
 * the ring finger dips in week three (a tired week) before recovering. Spasticity eases, so
 * the evaluations show less resistance and less speed dependence. One session has a rigid
 * index finger that the glove's current limit stops safely. The AI therapy coach is used in
 * the last week, so its decisions and the patient's check-ins exist only there.
 */
import { SimWorld } from "../../frontend/src/glove/sim";
import {
  PATIENT_PRESETS,
  type PatientPreset,
} from "../../frontend/src/glove/sim/patient";
import {
  createExerciseEngine,
  createEvaluationEngine,
} from "../../frontend/src/engine";
import type { Output } from "../../frontend/src/engine";
import type {
  AttemptResult,
  ExercisePlanItem,
  SessionSummary,
} from "../../frontend/src/contracts/engine";
import { GLOVE_FINGERS, type Quint } from "../../frontend/src/contracts/glove";
import type { GloveEvent } from "../../frontend/src/contracts/glove";
import type { FingerId } from "../../frontend/src/contracts/vision";
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from "../../frontend/src/contracts/poses";
import calibrationFixture from "../../contracts/fixtures/calibration.json";
import type { Calibration } from "../../frontend/src/contracts/calibration";

const DAY = 86_400_000;
const SHORT_PLAN: ExercisePlanItem[] = DEFAULT_PLAN.map((p) => ({
  ...p,
  reps: 1,
}));

export const DEMO_PROFILE = {
  pseudonym: "M.R. (demo patient)",
  affected_hand: "right",
  condition:
    "Ischemic stroke (left hemisphere), 5 months ago. Right-hand weakness with mild flexor " +
    "spasticity: starts every grip but can't finish it; ring and little finger weakest, " +
    "thumb opposition limited. Home practice between weekly therapy visits.",
  goals:
    "Hold a cup with the right hand. Button a shirt. Carry a light shopping bag.",
  therapist_name: "L. Okafor (demo therapist)",
  therapist_email: "therapist@example.com",
} as const;

type Plan = "glides" | "short";
interface Visit {
  daysAgo: number;
  hour: number; // UTC
  plan: Plan;
  evaluation?: boolean;
  rigidIndexAttempt?: number; // index of the attempt during which the index finger is rigid
  coach?: boolean; // AI therapy coach on (last week only)
}
/** Irregular home practice: 14 sessions over four weeks, a few long gaps, mixed lengths. */
const VISITS: Visit[] = [
  { daysAgo: 27, hour: 10, plan: "glides", evaluation: true }, // first visit, with the therapist
  { daysAgo: 25, hour: 17, plan: "short" },
  { daysAgo: 24, hour: 9, plan: "glides" },
  { daysAgo: 21, hour: 11, plan: "glides" },
  { daysAgo: 20, hour: 18, plan: "short" },
  { daysAgo: 17, hour: 10, plan: "glides", rigidIndexAttempt: 9 },
  { daysAgo: 14, hour: 10, plan: "glides", evaluation: true },
  { daysAgo: 13, hour: 19, plan: "short" },
  { daysAgo: 10, hour: 9, plan: "glides" }, // tired week: ring finger dips
  { daysAgo: 9, hour: 17, plan: "short" },
  { daysAgo: 6, hour: 10, plan: "glides", evaluation: true, coach: true },
  { daysAgo: 4, hour: 11, plan: "glides", coach: true },
  { daysAgo: 3, hour: 18, plan: "short", coach: true },
  { daysAgo: 1, hour: 10, plan: "glides", evaluation: true, coach: true },
];
const FIRST_DAY = VISITS[0].daysAgo;

/** Small deterministic PRNG so the story is identical on every run. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far the patient can close each finger alone, and how stiff the hand is, on a visit. */
export function patientOnVisit(visit: Visit, random: () => number) {
  const p = (FIRST_DAY - visit.daysAgo) / FIRST_DAY; // 0 first visit … ~1 last
  const ease = 1 - (1 - p) ** 2; // fast early gains that slow down
  const noise = (amount: number) => (random() - 0.5) * 2 * amount;
  const tiredWeek = visit.daysAgo === 10 || visit.daysAgo === 9;
  const ability: Record<FingerId, number> = {
    thumb: 0.2 + 0.13 * p,
    index: 0.18 + 0.42 * ease,
    middle: 0.27 + 0.3 * ease,
    ring: 0.14 + 0.3 * ease - (tiredWeek ? 0.1 : 0),
    pinky: 0.1 + 0.14 * Math.min(1, p / 0.45),
  };
  const active_max = GLOVE_FINGERS.map((f) =>
    Math.max(0.05, ability[f] + noise(0.025)),
  ) as Quint;
  return {
    active_max,
    active_speed: 0.45 + 0.2 * p,
    reaction_s: 0.6 - 0.2 * p,
    stiffness: { k0: 190 - 80 * p + noise(8), kv: 150 - 75 * p + noise(6) },
  };
}

interface Therapy {
  decisions: Record<string, unknown>[];
  feelings: Record<string, unknown>[];
}
/** Coach check-ins every ~5 attempts with fatigue rising through the session, and a few
 * plain-language decisions that match what the attempts actually showed. */
function coachRecords(
  attempts: AttemptResult[],
  visitIndex: number,
  random: () => number,
): Therapy {
  const decisions: Record<string, unknown>[] = [];
  const feelings: Record<string, unknown>[] = [];
  const later = (iso: string, seconds: number) =>
    new Date(Date.parse(iso) + seconds * 1000).toISOString();
  const mostHelped = (() => {
    const need = new Map<FingerId, number>();
    for (const a of attempts)
      for (const f of a.fingers)
        if (f.scored && f.assist_needed !== null)
          need.set(f.finger, (need.get(f.finger) ?? 0) + f.assist_needed);
    return [...need.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "pinky";
  })();
  const name = (f: FingerId) =>
    f === "pinky" ? "little finger" : `${f} finger`;
  let n = 0;
  const decide = (
    t: string,
    tool: string,
    requested: Record<string, unknown>,
    applied: Record<string, unknown> | null,
    result: "applied" | "clamped",
    reason: string,
  ) =>
    decisions.push({
      id: `demo-${visitIndex}-${++n}`,
      t,
      session_id: null,
      tool,
      requested,
      applied,
      result,
      reason,
      source: "coach",
    });
  attempts.forEach((attempt, i) => {
    if (i === 0 || i % 5 !== 4) return;
    const share = i / Math.max(1, attempts.length - 1);
    const fatigue = Math.min(
      7,
      Math.round(2 + share * 4 + (random() - 0.3) * 1.5),
    );
    const pain = random() < 0.15 ? 2 : random() < 0.5 ? 1 : 0;
    const t = later(attempt.ended_at, 2);
    feelings.push({
      t,
      session_id: 0, // replaced by the seeder with the stored session id
      attempt_index: i,
      pain,
      fatigue,
      note:
        fatigue >= 5
          ? "Hand feels heavy now."
          : pain > 0
            ? "A little tight in the knuckles."
            : "Feels fine.",
      source: "voice",
    });
    decide(
      t,
      "record_feeling",
      { pain, fatigue },
      { pain, fatigue },
      "applied",
      "Check-in after a few attempts.",
    );
    if (fatigue >= 5)
      decide(
        later(t, 1),
        "add_rest",
        { seconds: 15 },
        { seconds: 15 },
        "applied",
        "You said your hand feels heavy, so let's rest a little longer.",
      );
  });
  if (attempts.length >= 10) {
    const t = later(attempts[4].ended_at, 4);
    decide(
      t,
      "adjust_help",
      { finger: mostHelped, direction: "more" },
      { finger: mostHelped, assist_delay_s: 4 },
      "applied",
      `The glove finished every closing pose for your ${name(mostHelped)}; it will start helping a bit sooner.`,
    );
    decide(
      later(attempts[8].ended_at, 3),
      "set_attempt_time",
      { seconds: 10 },
      { seconds: 9 },
      "clamped",
      "You were still closing when time ran out; a little more time to try on your own.",
    );
  }
  return { decisions, feelings };
}

export async function generateDemo(endDate: string) {
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) throw new Error("Invalid demo end date");
  const midnight = Math.floor(end / DAY) * DAY;
  const random = mulberry32(20261107);
  const calibration = structuredClone(calibrationFixture) as Calibration;
  calibration.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  // The simulated fixture has no measured empty-glove baseline.
  calibration.friction = {};
  // The shared fixture predates the 5-servo supply; use the 5-servo default so ordinary
  // practice never trips the limit and only the rigid-finger story produces a stop.
  calibration.current_limit_ma = 1500;
  const sessions = [];
  const evaluations = [];
  const presets = PATIENT_PRESETS as Record<
    string,
    (typeof PATIENT_PRESETS)["moderate"]
  >;
  for (const [index, visit] of VISITS.entries()) {
    const preset = `demo-${index}`;
    presets[preset] = patientOnVisit(visit, random);
    const world = new SimWorld({
      autoStart: false,
      seed: 1100 + index,
      preset: preset as PatientPreset,
    });
    // SimWorld stamps time from performance.now(), a different float offset on every run,
    // and the engines compare those stamps: pin the (never auto-started) clock to 0 so the
    // same seed always produces the same history.
    (world as unknown as { clockOrigin: number }).clockOrigin = 0;
    // Sessions start at the visit hour; the simulated clock runs from there.
    const started = midnight - visit.daysAgo * DAY + visit.hour * 3_600_000;
    const timestamp = (now: number) =>
      new Date(started + now - world.origin).toISOString();
    const events: GloveEvent[] = [];
    world.glove.onEvent((event) => events.push(event));
    await world.glove.connect();
    for (const [i, finger] of GLOVE_FINGERS.entries()) {
      const servo = calibration.servo.find((entry) => entry.finger === finger);
      if (!servo) throw new Error(`Missing demo calibration for ${finger}`);
      world.glove.calib(i as 0 | 1 | 2 | 3 | 4, servo.min_deg, servo.max_deg);
    }
    world.glove.limit(calibration.current_limit_ma);
    world.vision.setCalibration(calibration.camera);
    await world.vision.start({ affectedHand: "right" });
    world.advance(200);
    events.length = 0;
    const plan = visit.plan === "glides" ? DEFAULT_PLAN : SHORT_PLAN;
    const attempts: AttemptResult[] = [];
    let summary: SessionSummary | undefined;
    const rigidAt = visit.rigidIndexAttempt;
    const apply = (out: Output) => {
      for (const command of out.commands) {
        if (command.t === "target") world.glove.target(command.f, command.v);
        else if (command.t === "follow") world.glove.follow(command.f);
        else if (command.t === "limit") world.glove.limit(command.ma);
        else world.glove.release();
      }
      for (const event of out.events) {
        if (event.kind === "phase") {
          if (event.phase === "PRESENT" && rigidAt !== undefined)
            world.controls.setRigid("index", attempts.length === rigidAt);
          world.setIntent(event.pose, event.phase);
        }
        if (event.kind === "attempt_done") attempts.push(event.result);
        if (event.kind === "session_done") summary = event.summary;
      }
    };
    const input = () => ({
      now: world.timestamp(),
      vision: world.vision.latest(),
      tel: world.glove.latest(),
      gloveEvents: events.splice(0),
      gloveConnected: true,
    });
    const engine = createExerciseEngine({ timestamp });
    apply(
      engine.start(
        plan,
        DEFAULT_EXERCISE_SETTINGS,
        calibration,
        world.timestamp(),
      ),
    );
    for (let ticks = 0; engine.state().phase !== "DONE"; ticks++) {
      if (ticks > 30000)
        throw new Error(`Demo session ${index} did not finish`);
      world.advance(20);
      apply(engine.tick(input()));
      // Retain genuine safety interruptions; acknowledge release and move on.
      if (engine.state().phase === "PAUSED") {
        world.controls.setRigid("index", false);
        apply(engine.resume(world.timestamp()));
      }
    }
    const expected = plan.reduce((sum, item) => sum + item.reps, 0);
    if (!summary || attempts.length !== expected)
      throw new Error(`Incomplete engine session ${index}`);
    sessions.push({
      started_at: attempts[0].started_at,
      ended_at: timestamp(world.timestamp()),
      plan,
      settings: DEFAULT_EXERCISE_SETTINGS,
      attempts,
      summary,
      ...(visit.coach
        ? coachRecords(attempts, index, random)
        : { decisions: [], feelings: [] }),
    });
    if (visit.evaluation) {
      world.setIntent("open", "DONE");
      world.advance(2000);
      const evaluation = createEvaluationEngine({ timestamp });
      apply(
        evaluation.start(DEFAULT_EVAL_SETTINGS, calibration, world.timestamp()),
      );
      for (let ticks = 0; !evaluation.state().result; ticks++) {
        if (ticks > 10000)
          throw new Error(`Demo evaluation ${index} did not finish`);
        world.advance(20);
        apply(evaluation.tick(input()));
      }
      evaluations.push(evaluation.state().result!);
    }
    world.stop();
    delete presets[preset];
  }
  return {
    profile: DEMO_PROFILE,
    calibration,
    sessions,
    evaluations,
  };
}
