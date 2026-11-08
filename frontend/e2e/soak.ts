import { askForHelpWhenOffered } from './askForHelp';
import { createGloveController } from '../src/glove/GloveProvider';
import { createVisionController } from '../src/vision/VisionProvider';
import { SimWorld } from '../src/glove/sim';
import { RehabRuntime } from '../src/runtime/runtime';
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from '../src/contracts/poses';
import { calibration as fixture } from '../src/contracts/fixtures.check';
import { createCalibration } from '../src/api/client';

/** Browser-only entry, outside the production app/build. Exercises the real API. */
async function main() {
  const world = new SimWorld({ seed: 42, timeScale: 3 });
  const glove = createGloveController({ world, kind: 'sim' });
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: 'sim',
  });
  const calibration = structuredClone(fixture);
  calibration.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  await createCalibration({
    servo: calibration.servo,
    camera: calibration.camera,
    friction: calibration.friction,
    current_limit_ma: calibration.current_limit_ma,
  });
  glove.mount();
  await vision.start();
  const runtime = new RehabRuntime({ glove, vision, storage: localStorage });
  runtime.mount();
  askForHelpWhenOffered(runtime, world);
  await runtime.calibration.reload();
  const state = {
    sessions: 0,
    evaluations: 0,
    attempts: 0,
    safety: 0,
    failures: [] as string[],
  };
  runtime.exercise.onEvent((event) => {
    if (event.kind === 'session_done') {
      state.sessions++;
      state.attempts += event.summary.attempts;
    }
    if (event.kind === 'safety') state.safety++;
  });
  window.soak = {
    snapshot: () => ({
      ...state,
      saving: runtime.persistence.store.getState(),
      phase: runtime.exercise.view().phase,
      stage: runtime.evaluation.view().stage,
      diagnostics: runtime.diagnosticsStore.getState(),
    }),
    start: async () => {
      const wait = (predicate: () => boolean) =>
        new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (predicate()) {
              clearInterval(timer);
              resolve();
            }
          }, 50);
        });
      for (let i = 0; i < 2; i++) {
        await runtime.exercise.start(DEFAULT_PLAN, DEFAULT_EXERCISE_SETTINGS);
        await wait(() => runtime.exercise.view().phase === 'DONE');
        await runtime.persistence.flush();
      }
      await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
      await wait(() => runtime.evaluation.view().stage === 'done');
      state.evaluations++;
      await runtime.persistence.flush();
    },
    dispose: () => {
      runtime.dispose();
      vision.stop();
      glove.dispose();
    },
  };
}
declare global {
  interface Window {
    soak: { snapshot(): unknown; start(): Promise<void>; dispose(): void };
  }
}
void main();
