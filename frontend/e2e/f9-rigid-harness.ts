import { createGloveController } from '../src/glove/GloveProvider';
import { createVisionController } from '../src/vision/VisionProvider';
import { SimWorld } from '../src/glove/sim';
import { RehabRuntime } from '../src/runtime/runtime';
import { DEFAULT_EXERCISE_SETTINGS } from '../src/contracts/poses';
import { GLOVE_FINGERS, type GloveFinger } from '../src/contracts/glove';
import type { EngineEvent } from '../src/contracts/engine';
import { sessions } from '../src/contracts/fixtures.check';
import type { RuntimeApi } from '../src/runtime/persistence';

// Browser integration entry only: production providers/transport/engine, seeded clock.
// REST writes use an isolated sink; the page-flow specs exercise real persistence.
export async function probeRigidFinger(
  finger: GloveFinger | null,
  preset: 'mild' | 'moderate',
) {
  const world = new SimWorld({ autoStart: false, seed: 42, preset });
  const glove = createGloveController({ world, kind: 'sim' });
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: 'sim',
  });
  const events: EngineEvent[] = [];
  const targets: { at: number; f: number[] }[] = [];
  const starts: { at: number; finger: GloveFinger }[] = [];
  let peakMoving = 0;
  let peakMa = 0;
  const target = world.glove.target.bind(world.glove);
  world.glove.target = (f, v) => {
    targets.push({ at: world.now, f: [...f] });
    f.forEach((value, i) => {
      if (
        value !== world.firmware.goal[i] &&
        Math.abs(value - world.firmware.position[i]) > 0.05
      )
        starts.push({ at: world.now, finger: GLOVE_FINGERS[i] });
    });
    target(f, v);
  };
  const sink = {
    createSession: async (value) => ({ ...sessions[0], ...value, id: 1 }),
    addAttempt: async ({ result }) => ({ ...result, id: 1, session_id: 1 }),
    endSession: async ({ summary }) => ({ ...sessions[0], summary, id: 1 }),
    addCoachDecisions: async () => {},
    addFeelings: async () => {},
    createEvaluation: async (value) => ({
      ...value,
      id: 1,
      is_demo: value.is_demo ?? true,
    }),
  } satisfies RuntimeApi;
  const runtime = new RehabRuntime({
    glove,
    vision,
    api: sink,
    now: world.timestamp,
  });
  world.ticks.subscribe(() => {
    peakMa = Math.max(peakMa, world.power.demandMa);
    // A phase can enter ASSIST before the first target; follow pays out independently.
    // Enforce the winding concurrency cap whenever the motors actually run target.
    if (world.firmware.mode !== 'target') return;
    peakMoving = Math.max(
      peakMoving,
      world.firmware.position.filter(
        (v, i) => world.firmware.goal[i] > v + 1e-6,
      ).length,
    );
  });
  glove.mount();
  await vision.start();
  runtime.mount();
  await runtime.calibration.reload();
  // 2200 mA proves the softer detector works below the independent hard cut-off.
  runtime.calibration.current!.current_limit_ma = 2200;
  await runtime.calibration.sendToGlove();
  runtime.exercise.onEvent((event) => events.push(event));
  try {
    await runtime.exercise.start(
      [{ pose: 'open', reps: finger ? 3 : 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    let rigid = false;
    for (
      let elapsed = 0;
      elapsed < 100_000 &&
      runtime.exercise.view().phase !== 'DONE' &&
      !runtime.exercise.view().paused;
      elapsed += 20
    ) {
      if (finger && !rigid && runtime.exercise.view().phase === 'ASSIST') {
        world.controls.setRigid(finger, true);
        rigid = true;
      }
      world.advance(20);
    }
    await runtime.persistence.flush();
    return {
      events: events.filter(
        (e) =>
          e.kind === 'resistance' ||
          e.kind === 'safety' ||
          e.kind === 'assist_started',
      ),
      results: events
        .filter((e) => e.kind === 'attempt_done')
        .map((e) => ({
          safety: e.result.safety_events,
          scored: e.result.fingers.filter((f) => f.scored).map((f) => f.finger),
        })),
      targets,
      starts,
      peakMoving,
      peakMa,
      phase: runtime.exercise.view().phase,
      calibration: world.firmware.info().calib,
      released: world.firmware.mode === 'none',
      fingers: GLOVE_FINGERS,
    };
  } finally {
    runtime.dispose();
    vision.stop();
    glove.dispose();
  }
}
