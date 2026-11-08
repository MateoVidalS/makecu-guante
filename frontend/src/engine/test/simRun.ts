import { GLOVE_FINGERS, type GloveEvent } from '../../contracts/glove';
import type { EngineEvent, ExercisePlanItem } from '../../contracts/engine';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { SimWorld } from '../../glove/sim/simWorld';
import type { PatientPreset } from '../../glove/sim/patient';
import { createExerciseEngine } from '../exercise';
import type { Output, PowerAwareExerciseSettings } from '../types';
import { calibration as fixture } from './fakeWorld';

export async function simRun(
  preset: PatientPreset,
  plan: ExercisePlanItem[],
  limit = 2200,
  settings: Partial<PowerAwareExerciseSettings> = {},
) {
  const world = new SimWorld({ autoStart: false, preset, seed: 42 });
  const engine = createExerciseEngine({ currentLimitMa: limit });
  const pending: GloveEvent[] = [];
  const events: EngineEvent[] = [];
  const commands: {
    at: number;
    phase: string;
    command: Output['commands'][number];
    position: number[];
  }[] = [];
  const calibration = structuredClone(fixture);
  calibration.current_limit_ma = limit;
  calibration.assist_direction = 'open';
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
  const accept = (out: Output) => {
    for (const cmd of out.commands) {
      commands.push({
        at: world.now,
        phase: engine.state().phase,
        command: cmd,
        position: [...world.firmware.position],
      });
      if (cmd.t === 'target') world.glove.target(cmd.f, cmd.v);
      else if (cmd.t === 'follow') world.glove.follow(cmd.f);
      else if (cmd.t === 'release') world.glove.release();
      else world.glove.limit(cmd.ma);
    }
    events.push(...out.events);
    for (const event of out.events)
      if (event.kind === 'phase') world.setIntent(event.pose, event.phase);
  };
  await world.glove.connect();
  calibration.servo.forEach((s, i) =>
    world.glove.calib(i as 0 | 1 | 2 | 3 | 4, s.min_deg, s.max_deg),
  );
  world.glove.limit(limit);
  world.vision.setCalibration(calibration.camera);
  await world.vision.start({ affectedHand: 'right' });
  world.glove.onEvent((event) => pending.push(event));
  accept(
    engine.start(
      plan,
      {
        ...DEFAULT_EXERCISE_SETTINGS,
        present_s: 0,
        attempt_s: 2,
        assist_max_s: 15,
        hold_s: 2,
        rest_s: 0.1,
        ...settings,
      },
      calibration,
      world.timestamp(),
    ),
  );
  const step = (ms = 20) => {
    world.advance(ms);
    const out = engine.tick({
      now: world.timestamp(),
      vision: world.vision.latest(),
      tel: world.glove.latest(),
      gloveConnected: world.glove.connection() === 'connected',
      gloveEvents: pending.splice(0),
    });
    accept(out);
    return out;
  };
  return { world, engine, events, commands, accept, step };
}
