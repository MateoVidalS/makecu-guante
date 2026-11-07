import { SimWorld } from "../../frontend/src/glove/sim";
import type { PatientPreset } from "../../frontend/src/glove/sim/patient";
import {
  createExerciseEngine,
  createEvaluationEngine,
} from "../../frontend/src/engine";
import type { Output } from "../../frontend/src/engine";
import type {
  AttemptResult,
  SessionSummary,
} from "../../frontend/src/contracts/engine";
import { GLOVE_FINGERS } from "../../frontend/src/contracts/glove";
import type { GloveEvent } from "../../frontend/src/contracts/glove";
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from "../../frontend/src/contracts/poses";
import calibrationFixture from "../../contracts/fixtures/calibration.json";
import type { Calibration } from "../../frontend/src/contracts/calibration";

export async function generateDemo(endDate: string) {
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) throw new Error("Invalid demo end date");
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
  const sessions = [];
  const evaluations = [];
  const days = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0];
  const preset = (i: number): PatientPreset =>
    i < 4 ? "severe" : i < 8 ? "moderate" : "mild";
  const evaluationDays = new Set([0, 3, 7, 10]);
  for (const [index, daysAgo] of days.entries()) {
    const world = new SimWorld({
      autoStart: false,
      seed: 1100 + index,
      preset: preset(index),
    });
    const started = end - daysAgo * 86400000;
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
    const attempts: AttemptResult[] = [];
    let summary: SessionSummary | undefined;
    const apply = (out: Output) => {
      for (const command of out.commands) {
        if (command.t === "target") world.glove.target(command.f, command.v);
        else if (command.t === "follow") world.glove.follow(command.f);
        else if (command.t === "limit") world.glove.limit(command.ma);
        else world.glove.release();
      }
      for (const event of out.events) {
        if (event.kind === "phase") world.setIntent(event.pose, event.phase);
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
        DEFAULT_PLAN,
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
      // Retain genuine safety interruptions; acknowledge release and move to rest.
      if (engine.state().phase === "PAUSED")
        apply(engine.resume(world.timestamp()));
    }
    if (!summary || attempts.length !== 15)
      throw new Error("Incomplete engine session");
    sessions.push({
      started_at: attempts[0].started_at,
      ended_at: timestamp(world.timestamp()),
      plan: DEFAULT_PLAN,
      settings: DEFAULT_EXERCISE_SETTINGS,
      attempts,
      summary,
      preset: preset(index),
    });
    if (evaluationDays.has(index)) {
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
  }
  return { calibration, sessions, evaluations };
}
