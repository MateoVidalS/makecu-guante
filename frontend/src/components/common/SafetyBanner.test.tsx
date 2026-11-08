import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SimWorld } from '../../glove/sim';
import { createGloveController } from '../../glove/GloveProvider';
import { createVisionController } from '../../vision/VisionProvider';
import { RuntimeProvider } from '../../runtime';
import { RehabRuntime } from '../../runtime/runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import type { RuntimeApi } from '../../runtime/persistence';
import * as api from '../../api/client';
import { calibration as fixture } from '../../contracts/fixtures.check';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type Calibration,
} from '../../contracts/calibration';
import type { EngineEvent } from '../../contracts/engine';
import {
  DEFAULT_EVAL_SETTINGS,
  DEFAULT_EXERCISE_SETTINGS,
} from '../../contracts/poses';
import { SafetyBanner } from './index';
import { RELEASE_CONFIRM_MS } from './safetyRecovery';

// The banner reads the glove through useGlove(); hand it the controller that drives the
// simulated firmware, so STOP, its refusals and telemetry come from the real sim (no hardware).
const glove = vi.hoisted(() => ({
  current: null as ReturnType<typeof createGloveController> | null,
}));
vi.mock('../../glove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../glove')>()),
  useGlove: () => glove.current!,
}));

const STOPPED = 'Stopped. Release the STOP button, then press Resume.';
const STOP_FIRST = 'Release the STOP button first, then press Resume.';
const STOP_RELEASED = 'STOP released. Press Resume when ready.';
const UNCONFIRMED =
  "The glove didn't confirm the release. Check it, then press Resume.";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((f) => f());
  vi.useRealTimers();
});

function simGlove() {
  const world = new SimWorld({
    autoStart: false,
    seed: 42,
    preset: 'moderate',
  });
  const controller = createGloveController({ world, kind: 'sim' });
  controller.mount();
  glove.current = controller;
  cleanups.push(() => controller.dispose());
  return { world, controller };
}
/** The real runtime on the simulator, as in runtime.test.ts. */
async function realRuntime() {
  const calibration: Calibration = structuredClone(fixture);
  calibration.assist_direction = 'open';
  calibration.current_limit_ma = 1500;
  calibration.camera.camera_view = CURRENT_CAMERA_VIEW;
  calibration.camera.flex_model = CURRENT_FLEX_MODEL;
  calibration.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  vi.spyOn(api, 'getLatestCalibration').mockResolvedValue(calibration);
  const { world, controller } = simGlove();
  const vision = createVisionController({
    simSource: world.vision,
    initialKind: 'sim',
  });
  const ok = vi.fn().mockResolvedValue({ id: 1 });
  const runtime = new RehabRuntime({
    glove: controller,
    vision,
    api: {
      createSession: ok,
      addAttempt: ok,
      endSession: ok,
      addCoachDecisions: ok,
      addFeelings: ok,
      createEvaluation: ok,
    } as unknown as RuntimeApi,
    storage: { getItem: () => null, setItem: () => {} },
    now: world.timestamp,
  });
  await vision.start();
  runtime.mount();
  await runtime.calibration.reload();
  world.advance(200);
  cleanups.push(() => {
    runtime.dispose();
    vision.stop();
  });
  return { runtime, world };
}
function until(world: SimWorld, predicate: () => boolean, maxMs = 120_000) {
  act(() => {
    for (let ms = 0; ms < maxMs && !predicate(); ms += 20) world.advance(20);
  });
  expect(predicate(), 'simulator reached the expected state').toBe(true);
}
const advance = (world: SimWorld, ms: number) => act(() => world.advance(ms));
const banner = () => screen.queryByRole('alert');
const resumeButton = () => screen.getByRole('button', { name: 'Resume' });

describe('SafetyBanner STOP recovery on the real runtime (simulated glove)', () => {
  async function stoppedPractice() {
    const { runtime, world } = await realRuntime();
    render(
      <RuntimeProvider runtime={runtime}>
        <SafetyBanner />
      </RuntimeProvider>,
    );
    await act(() =>
      runtime.exercise.start(
        [{ pose: 'open', reps: 2 }],
        DEFAULT_EXERCISE_SETTINGS,
      ),
    );
    until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
    act(() => world.controls.pressStop());
    advance(world, 100);
    expect(runtime.exercise.view().phase).toBe('PAUSED');
    expect(banner()).toHaveTextContent(STOPPED);
    expect(resumeButton()).toHaveFocus();
    return { runtime, world };
  }

  it('returns to an actionable banner when Resume is pressed while STOP is held, and resumes only after a second press', async () => {
    const { runtime, world } = await stoppedPractice();
    const release = vi.spyOn(world.glove, 'release');
    fireEvent.click(resumeButton());
    // The firmware refused `release` (STOP held); the engine latched PAUSED again.
    expect(release).toHaveBeenCalled();
    expect(world.firmware.state).toBe('fault');
    expect(runtime.exercise.view().phase).toBe('PAUSED');
    expect(banner()).toHaveTextContent(STOP_FIRST);
    expect(banner()).not.toHaveTextContent('Releasing');
    expect(resumeButton()).toBeEnabled();
    expect(resumeButton()).toHaveFocus();
    // It stays actionable; nothing is left waiting for an idle frame.
    advance(world, RELEASE_CONFIRM_MS + 1000);
    expect(banner()).toHaveTextContent(STOP_FIRST);
    expect(resumeButton()).toBeEnabled();

    release.mockClear();
    act(() => world.controls.releaseStop());
    expect(banner()).toHaveTextContent(STOP_RELEASED);
    // Releasing STOP never resumes by itself: no command, the latch stays, practice stays paused.
    advance(world, 3000);
    expect(release).not.toHaveBeenCalled();
    expect(world.firmware.state).toBe('fault');
    expect(runtime.exercise.view().phase).toBe('PAUSED');
    expect(banner()).toHaveTextContent(STOP_RELEASED);

    fireEvent.click(resumeButton());
    expect(release).toHaveBeenCalledOnce();
    expect(banner()).toHaveTextContent('Releasing the glove…');
    expect(resumeButton()).toBeDisabled();
    advance(world, 100);
    expect(world.firmware.state).toBe('idle');
    expect(banner()).not.toBeInTheDocument();
    until(world, () => runtime.exercise.view().phase === 'REST');
  });

  it('resumes normally when STOP is released before Resume', async () => {
    const { runtime, world } = await stoppedPractice();
    act(() => world.controls.releaseStop());
    expect(banner()).toHaveTextContent(STOP_RELEASED);
    expect(runtime.exercise.view().phase).toBe('PAUSED');
    fireEvent.click(resumeButton());
    expect(banner()).toHaveTextContent('Releasing the glove…');
    advance(world, 100);
    expect(world.firmware.state).toBe('idle');
    expect(banner()).not.toBeInTheDocument();
    until(world, () => runtime.exercise.view().phase === 'REST');
    until(world, () => runtime.exercise.view().phase === 'ATTEMPT');
  });

  it('shows the STOP copy again if STOP is pressed while the glove is releasing', async () => {
    const { world } = await stoppedPractice();
    act(() => world.controls.releaseStop());
    // Hold the release confirmation back so "Releasing…" is still showing.
    fireEvent.click(resumeButton());
    expect(banner()).toHaveTextContent('Releasing the glove…');
    act(() => world.controls.pressStop());
    expect(banner()).toHaveTextContent(STOPPED);
    expect(resumeButton()).toBeEnabled();
  });

  it('recovers the same way after STOP ends an evaluation (no session left to resume)', async () => {
    const { runtime, world } = await realRuntime();
    render(
      <RuntimeProvider runtime={runtime}>
        <SafetyBanner />
      </RuntimeProvider>,
    );
    await act(() => runtime.evaluation.start(DEFAULT_EVAL_SETTINGS));
    until(world, () => runtime.evaluation.view().stage === 'sweep');
    act(() => world.controls.pressStop());
    expect(runtime.evaluation.view().stage).toBe('aborted');
    expect(banner()).toHaveTextContent(STOPPED);

    fireEvent.click(resumeButton());
    expect(world.firmware.state).toBe('fault');
    expect(banner()).toHaveTextContent(STOP_FIRST);
    expect(resumeButton()).toBeEnabled();

    act(() => world.controls.releaseStop());
    expect(banner()).toHaveTextContent(STOP_RELEASED);
    advance(world, 3000);
    expect(world.firmware.state).toBe('fault');

    const target = vi.spyOn(world.glove, 'target');
    fireEvent.click(resumeButton());
    advance(world, 100);
    expect(world.firmware.state).toBe('idle');
    expect(banner()).not.toBeInTheDocument();
    // Clearing the latch never restarts the evaluation.
    advance(world, 3000);
    expect(target).not.toHaveBeenCalled();
    expect(runtime.evaluation.view().stage).toBe('aborted');
  });
});

describe('SafetyBanner releasing fallback', () => {
  function scripted() {
    const { world } = simGlove();
    const runtime = new ScriptedRuntime({ persist: false });
    let emit: (event: EngineEvent) => void = () => {};
    vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
      emit = cb;
      return () => {};
    });
    // A resume whose confirmation never arrives: no phase change, no telemetry.
    const resume = vi
      .spyOn(runtime.exercise, 'resume')
      .mockImplementation(() => {});
    runtime.exerciseStore.setState({ phase: 'PAUSED', paused: true });
    render(
      <RuntimeProvider runtime={runtime}>
        <SafetyBanner />
      </RuntimeProvider>,
    );
    return { world, runtime, resume, emit: (e: EngineEvent) => emit(e) };
  }

  it('never stays on "Releasing the glove…": it offers Resume again after the timeout', () => {
    vi.useFakeTimers();
    const { emit, resume } = scripted();
    act(() =>
      emit({ kind: 'safety', source: 'camera_lost', finger: null, ma: null }),
    );
    fireEvent.click(resumeButton());
    expect(resume).toHaveBeenCalledOnce();
    expect(banner()).toHaveTextContent('Releasing the glove…');
    expect(resumeButton()).toBeDisabled();
    act(() => vi.advanceTimersByTime(RELEASE_CONFIRM_MS - 100));
    expect(banner()).toHaveTextContent('Releasing the glove…');
    act(() => vi.advanceTimersByTime(200));
    expect(banner()).toHaveTextContent(UNCONFIRMED);
    expect(resumeButton()).toBeEnabled();
    expect(resumeButton()).toHaveFocus();
    fireEvent.click(resumeButton());
    expect(resume).toHaveBeenCalledTimes(2);
    expect(banner()).toHaveTextContent('Releasing the glove…');
  });

  it('names the STOP button when the timeout hits while STOP is held', () => {
    vi.useFakeTimers();
    const { emit, world } = scripted();
    act(() => world.controls.pressStop());
    act(() =>
      emit({ kind: 'safety', source: 'stop_button', finger: null, ma: null }),
    );
    expect(banner()).toHaveTextContent(STOPPED);
    fireEvent.click(resumeButton());
    act(() => vi.advanceTimersByTime(RELEASE_CONFIRM_MS + 100));
    expect(banner()).toHaveTextContent(STOP_FIRST);
    expect(resumeButton()).toBeEnabled();
  });

  it('returns to the STOP copy when the engine re-pauses while releasing', () => {
    const { emit, runtime, world } = scripted();
    act(() => world.controls.pressStop());
    act(() =>
      emit({ kind: 'safety', source: 'stop_button', finger: null, ma: null }),
    );
    fireEvent.click(resumeButton());
    act(() => runtime.exerciseStore.setState({ phase: 'RELEASE' }));
    expect(banner()).toHaveTextContent('Releasing the glove…');
    act(() => runtime.exerciseStore.setState({ phase: 'PAUSED' }));
    expect(banner()).toHaveTextContent(STOP_FIRST);
    expect(resumeButton()).toBeEnabled();
  });

  it('clears on a REST phase and replaces the copy on a new safety event', () => {
    const { emit, runtime } = scripted();
    act(() =>
      emit({ kind: 'safety', source: 'camera_lost', finger: null, ma: null }),
    );
    fireEvent.click(resumeButton());
    act(() =>
      emit({ kind: 'safety', source: 'overcurrent', finger: 'index', ma: 950 }),
    );
    expect(banner()).toHaveTextContent(
      'Stopped — I felt resistance in your index.',
    );
    expect(resumeButton()).toBeEnabled();
    act(() => runtime.exerciseStore.setState({ phase: 'REST' }));
    expect(banner()).not.toBeInTheDocument();
  });
});
