/** Deterministic, synthetic historical demo artifacts, not a hardware simulation.
 * Kept independent of the live simulator so historical closing records remain reproducible
 * after the simulator changes direction. All inserted sessions/evaluations are is_demo.
 */
import type {
  AttemptResult,
  ExercisePhase,
  ExercisePlanItem,
} from "../../frontend/src/contracts/engine";
import type { EvaluationResult } from "../../frontend/src/contracts/evaluation";
import {
  GLOVE_FINGERS,
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
import type {
  Calibration,
  AssistDirection,
} from "../../frontend/src/contracts/calibration";
import { summarizeSession } from "../../frontend/src/engine/metrics";
import calibrationFixture from "../../contracts/fixtures/calibration.json";

const DAY = 86_400_000;
export const DEMO_PROFILE = {
  pseudonym: "M.R. (demo patient)",
  affected_hand: "right",
  condition:
    "Ischemic stroke (left hemisphere), 5 months ago. Right-hand weakness with mild flexor tone: can make a fist but struggles to open; ring and little finger weakest. Earlier practice used the closing-assist glove.",
  goals: "Open the right hand to hold a cup. Release a light shopping bag.",
  therapist_name: "L. Okafor (demo therapist)",
  therapist_email: "therapist@example.com",
} as const;
const VISITS = [
  [27, 10, false],
  [25, 17, true],
  [24, 9, false],
  [21, 11, false],
  [20, 18, true],
  [17, 10, false],
  [14, 10, false],
  [13, 19, true],
  [10, 9, false],
  [9, 17, true],
  [6, 10, false],
  [4, 11, false],
  [3, 18, true],
  [1, 10, false],
] as const;
const iso = (ms: number) => new Date(ms).toISOString();
const rounded = (n: number) => Math.round(n * 10000) / 10000;
const lerp = (a: number, b: number, share: number) =>
  a + (b - a) * Math.max(0, Math.min(1, share));
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;

/** Finger-specific opening deficits shrink; little finger plateaus and ring has a tired week. */
function openingDeficits(daysAgo: number) {
  const progress = (24 - daysAgo) / 23;
  const ease = 1 - (1 - progress) ** 2;
  return [
    0.62 - 0.13 * progress,
    0.65 - 0.42 * ease,
    0.58 - 0.3 * ease,
    0.72 - 0.26 * ease + ([10, 9].includes(daysAgo) ? 0.1 : 0),
    0.76 - 0.14 * Math.min(1, progress / 0.45),
  ];
}

function attempt(
  start: number,
  index: number,
  pose: "open" | "full_fist",
  direction: AssistDirection,
  deficits: number[],
  rigid: boolean,
): AttemptResult {
  const opening = direction === "open" && pose === "open";
  const assisted = opening || direction === "close";
  const duration = rigid ? 12 : assisted ? 18 : 12;
  const target = GLOVE_FINGERS.map((f) => POSES[pose].closure[f]!);
  const best = target.map((c, i) =>
    rounded(opening ? deficits[i] : direction === "close" ? c * 0.5 : c),
  );
  const final = best.map((c, i) =>
    rigid && i === 1 ? c : opening ? 0.05 : target[i],
  );
  const trace: AttemptResult["trace"] = {
    hz: 20,
    t: [],
    closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
    servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
    ma: [],
    phase: [],
  };
  const currents: number[] = [];
  for (let tick = 0; tick <= duration * 20; tick++) {
    const t = tick / 20;
    const phase: ExercisePhase =
      t < 3
        ? "PRESENT"
        : t < 9
          ? "ATTEMPT"
          : assisted && t < duration - 3
            ? "ASSIST"
            : t < duration - 1
              ? assisted
                ? "ASSIST_HOLD"
                : "HOLD"
              : "RELEASE";
    trace.t.push(t);
    trace.phase.push(phase);
    for (const [i, f] of GLOVE_FINGERS.entries()) {
      const resting = opening ? 0.85 : 0.15;
      let closure = t < 3 ? resting : lerp(resting, best[i], (t - 3) / 3);
      if (assisted && t >= 9) closure = lerp(best[i], final[i], (t - 9) / 5);
      let pull =
        direction === "open"
          ? Math.max(0, pullFromClosure(closure) - 0.08)
          : Math.max(0, closure - 0.08);
      if (assisted && t >= 9) {
        const goal =
          direction === "open"
            ? Math.min(MAX_ASSIST_PULL, pullFromClosure(final[i]))
            : final[i];
        pull = lerp(pull, goal, (t - 9) / 5);
        // Opening measurements track pull during assistance, except the rigid index.
        if (opening && !(rigid && i === 1)) closure = closureFromPull(pull);
      }
      if (phase === "RELEASE") {
        pull *= Math.max(0, duration - t);
        closure = lerp(closure, resting, t - duration + 1);
      }
      trace.closure[f].push(rounded(closure));
      trace.servo[f].push(rounded(pull));
    }
    const ma = phase.startsWith("ASSIST")
      ? rounded(260 + mean(deficits) * 550 + (rigid ? 350 : 0))
      : phase === "RELEASE"
        ? 80
        : 160;
    trace.ma.push(ma);
    if (phase.startsWith("ASSIST")) currents.push(ma);
  }
  return {
    pose,
    rep: Math.floor(index / 2) + 1,
    index,
    started_at: iso(start),
    ended_at: iso(start + duration * 1000),
    reached_active: !assisted,
    reached_final: !rigid,
    assisted,
    time_to_position_s: assisted ? null : 3,
    active_ratio: rounded(
      mean(best.map((c, i) => (opening ? 1 - c : c / target[i]))),
    ),
    fingers: GLOVE_FINGERS.map((finger, i) => ({
      finger,
      scored: true,
      target: target[i],
      active_max: best[i],
      assist_needed: rounded(
        assisted ? (opening ? best[i] - target[i] : target[i] - best[i]) : 0,
      ),
      final: final[i],
    })),
    pinch_min: null,
    current_peak_ma: currents.length ? Math.max(...currents) : null,
    current_mean_ma: currents.length ? rounded(mean(currents)) : null,
    safety_events: rigid
      ? [
          {
            source: "resistance",
            finger: "index",
            ma: Math.max(...currents),
            t_rel: duration - 1,
          },
        ]
      : [],
    interrupted: rigid,
    trace,
  };
}

/** Synthetic flexor resistance increases with opening pull and with stretch speed. */
function evaluation(start: number, daysAgo: number): EvaluationResult {
  const progress = (24 - daysAgo) / 23;
  const sweeps = GLOVE_FINGERS.flatMap((finger, i) =>
    (["slow", "fast"] as const).map((speed) => {
      const v = speed === "slow" ? 0.2 : 1;
      const tone = 260 + i * 35 - progress * (60 + i * 8);
      const velocity = 160 + i * 20 - progress * (55 + i * 6);
      const points = Array.from({ length: 20 }, (_, n) => {
        const pos = rounded(n * 0.05);
        const excess_ma = rounded(
          (tone + velocity * v) * Math.max(0, pos - 0.15),
        );
        return { pos, excess_ma, ma: rounded(95 + excess_ma) };
      });
      return { finger, speed, v, points, aborted_at: null };
    }),
  );
  return {
    started_at: iso(start),
    ended_at: iso(start + 120_000),
    settings: DEFAULT_EVAL_SETTINGS,
    friction_used: true,
    sweeps,
    fingers: GLOVE_FINGERS.map((finger) => {
      const group = sweeps.filter((s) => s.finger === finger);
      const resistance = group.map((s) =>
        mean(
          s.points
            .filter((p) => p.pos >= 0.2 && p.pos <= 0.9)
            .map((p) => p.excess_ma),
        ),
      );
      return {
        finger,
        resistance_slow_ma: rounded(resistance[0]),
        resistance_fast_ma: rounded(resistance[1]),
        velocity_dependence_ma: rounded(resistance[1] - resistance[0]),
        peak_excess_ma: Math.max(
          ...group.flatMap((s) => s.points.map((p) => p.excess_ma)),
        ),
        aborted: false,
      };
    }),
  };
}

function coachRecords(attempts: AttemptResult[], visitIndex: number) {
  const feelings = attempts
    .filter((_, i) => i % 3 === 2)
    .map((a, i) => ({
      t: a.ended_at,
      attempt_index: a.index,
      pain: i % 2,
      fatigue: 3 + i,
      note: "Opening feels easier; the little finger still needs help.",
      source: "voice",
    }));
  const decisions = feelings.map((f, i) => ({
    id: `demo-${visitIndex}-${i}`,
    t: f.t,
    session_id: null,
    tool: "highlight_finger",
    requested: { finger: "pinky" },
    applied: { finger: "pinky" },
    result: "applied",
    reason: "Focus on opening your little finger.",
    source: "coach",
  }));
  return { feelings, decisions };
}

export async function generateDemo(end: string) {
  const date = new Date(end);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const calibration = structuredClone(calibrationFixture) as Calibration;
  calibration.assist_direction = "open";
  calibration.camera.camera_view = "front_upright";
  calibration.friction = Object.fromEntries(
    GLOVE_FINGERS.map((f) => [
      f,
      [0.2, 1].map((v) => ({
        v,
        points: [
          { pos: 0, ma: 95 },
          { pos: 0.95, ma: 95 },
        ],
      })),
    ]),
  );
  calibration.current_limit_ma = 1500;
  const legacy_calibration = {
    ...structuredClone(calibration),
    assist_direction: undefined,
  };
  const sessions = VISITS.map(([daysAgo, hour, short], visitIndex) => {
    const direction: AssistDirection = visitIndex < 2 ? "close" : "open";
    const plan: ExercisePlanItem[] =
      direction === "close"
        ? [{ pose: "full_fist", reps: short ? 4 : 10 }]
        : short
          ? OPEN_ASSIST_PLAN.slice(0, 4)
          : OPEN_ASSIST_PLAN;
    let clock = midnight - daysAgo * DAY + hour * 3_600_000;
    const attempts: AttemptResult[] = [];
    for (const item of plan)
      for (let rep = 0; rep < item.reps; rep++) {
        const a = attempt(
          clock,
          attempts.length,
          item.pose as "open" | "full_fist",
          direction,
          direction === "open"
            ? openingDeficits(daysAgo)
            : [0.6, 0.65, 0.58, 0.72, 0.76],
          visitIndex === 5 && attempts.length === 9,
        );
        a.rep = rep + 1;
        attempts.push(a);
        clock = Date.parse(a.ended_at) + 3000;
      }
    return {
      assist_direction: direction,
      started_at: attempts[0].started_at,
      ended_at: attempts.at(-1)!.ended_at,
      plan,
      settings: {
        ...DEFAULT_EXERCISE_SETTINGS,
        assist_speed: direction === "open" ? 0.2 : 0.3,
      },
      attempts,
      summary: summarizeSession(attempts),
      ...(daysAgo <= 6
        ? coachRecords(attempts, visitIndex)
        : { feelings: [], decisions: [] }),
    };
  });
  const evaluations = [24, 14, 6, 1].map((day) =>
    evaluation(midnight - day * DAY + 12 * 3_600_000, day),
  );
  return {
    profile: DEMO_PROFILE,
    calibration,
    legacy_calibration,
    sessions,
    evaluations,
  };
}
