import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent } from '../contracts/engine';
import { GLOVE_FINGERS, type GloveEvent } from '../contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import { SimWorld } from '../glove/sim/simWorld';
import { createExerciseEngine } from './exercise';
import { calibration as fixture } from './test/fakeWorld';
import type { Output } from './types';

// Match “Calibrate simulator”, with the five-servo firmware current limits.
const calibration = structuredClone(fixture);
calibration.servo = GLOVE_FINGERS.map((finger) => ({
  finger,
  min_deg: 20,
  max_deg: 150,
}));
calibration.camera.closed_flex = {
  thumb: 100,
  index: 270,
  middle: 270,
  ring: 270,
  pinky: 270,
};

async function run(
  finger: (typeof GLOVE_FINGERS)[number],
  limit: number,
  seed: number,
  preset: 'mild' | 'moderate' | 'severe',
) {
  const world = new SimWorld({ autoStart: false, seed, preset });
  const engine = createExerciseEngine();
  const pending: GloveEvent[] = [];
  const events: EngineEvent[] = [];
  const accept = (out: Output) => {
    for (const cmd of out.commands) {
      if (cmd.t === 'target') world.glove.target(cmd.f, cmd.v);
      else if (cmd.t === 'follow') world.glove.follow(cmd.f);
      else if (cmd.t === 'release') world.glove.release();
      else world.glove.limit(cmd.ma);
    }
    events.push(...out.events);
    for (const event of out.events)
      if (event.kind === 'phase') world.setIntent(event.pose, event.phase);
  };
  try {
    await world.glove.connect();
    calibration.servo.forEach((s, i) =>
      world.glove.calib(i as 0 | 1 | 2 | 3 | 4, s.min_deg, s.max_deg),
    );
    world.glove.limit(limit);
    world.vision.setCalibration(calibration.camera);
    await world.vision.start({ affectedHand: 'right' });
    world.glove.onEvent((event) => pending.push(event));
    // Enable rigidity when the patient has already tried, as in the live demo.
    let rigid = false;
    accept(
      engine.start(
        [{ pose: 'full_fist', reps: 3 }],
        DEFAULT_EXERCISE_SETTINGS,
        calibration,
        world.timestamp(),
      ),
    );
    for (
      let ms = 0;
      ms < 100_000 && !['DONE', 'PAUSED'].includes(engine.state().phase);
      ms += 20
    ) {
      if (!rigid && engine.state().phase === 'ASSIST') {
        world.controls.setRigid(finger, true);
        rigid = true;
      }
      world.advance(20);
      accept(
        engine.tick({
          now: world.timestamp(),
          vision: world.vision.latest(),
          tel: world.glove.latest(),
          gloveConnected: true,
          gloveEvents: pending.splice(0),
        }),
      );
    }
    return { events, phase: engine.state().phase };
  } finally {
    world.stop();
  }
}

describe('rigid finger safety with clean five-finger simulator calibration', () => {
  beforeEach(() => {
    // Keep the manually advanced simulator independent of wall-clock startup time.
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });
  for (const limit of [900, 1500, 2200]) {
    it.each(GLOVE_FINGERS)(
      `stops %s during full-fist assist at ${limit} mA`,
      async (finger) => {
        for (const preset of ['mild', 'moderate', 'severe'] as const) {
          const seed = 42;
          const { events } = await run(finger, limit, seed, preset);
          expect(events).toContainEqual(
            expect.objectContaining({ kind: 'assist_started' }),
          );
          expect(
            events.some(
              (e) =>
                (e.kind === 'resistance' ||
                  (e.kind === 'safety' && e.source === 'overcurrent')) &&
                (e.kind === 'safety' || e.finger === finger),
            ),
            JSON.stringify(events.filter((e) => e.kind !== 'progress')),
          ).toBe(true);
          expect(
            events
              .filter((e) => e.kind === 'attempt_done')
              .every((e) => e.result.safety_events.length > 0),
            `seed ${seed}, ${preset}`,
          ).toBe(true);
        }
      },
    );
  }
});
