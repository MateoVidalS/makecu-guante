import type { ReactNode } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { VoiceProvider } from '../../voice';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import type { EngineEvent, ExercisePhase } from '../../contracts/engine';
import type { FingerId } from '../../contracts/vision';
import type { FingerState } from '../../hand3d/scene';
import { watchResistance } from './resistanceStop';
import type { LiveStop } from './attemptStatus';
import Exercise from './index';

const hand = vi.hoisted(() => ({
  state: null as null | ((finger: FingerId) => FingerState),
}));
vi.mock('../../hand3d/VirtualHand', () => ({
  VirtualHand: (props: { state: (finger: FingerId) => FingerState }) => {
    hand.state = props.state;
    return <div>Hand preview</div>;
  },
}));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  localStorage.clear();
  hand.state = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
function mount(children: ReactNode, runtime: ScriptedRuntime) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GloveProvider>
        <VisionProvider>
          <RuntimeProvider runtime={runtime}>
            <VoiceProvider>
              <MemoryRouter>{children}</MemoryRouter>
            </VoiceProvider>
          </RuntimeProvider>
        </VisionProvider>
      </GloveProvider>
    </QueryClientProvider>,
  );
}
/** Advance the scripted session until `done` holds (fake time, 200 ms steps). */
function until(runtime: ScriptedRuntime, done: () => boolean, max = 40) {
  for (let t = 0; t < max && !done(); t += 0.2) act(() => runtime.advance(0.2));
  expect(done()).toBe(true);
}
/** Whole-page renders per fake step are slow in jsdom. */
const PAGE_TIMEOUT = 60_000;
const phase = (runtime: ScriptedRuntime) => runtime.exercise.view().phase;
const heading = () => screen.getByRole('heading', { level: 1 });
const gauge = (name: string) =>
  screen.getByRole('meter', { name }).closest('.mx-gauge');

describe('resistance stop on the live screen (EX-07)', () => {
  it('remembers the stop with its attempt and forgets it on the next one or a pause', () => {
    const listeners: ((e: EngineEvent) => void)[] = [];
    const exercise = {
      index: 2,
      onEvent: (cb: (e: EngineEvent) => void) => {
        listeners.push(cb);
        return () => undefined;
      },
      view: () => ({ index: exercise.index }) as never,
    };
    const seen: (LiveStop | null)[] = [];
    watchResistance(exercise, (stop) => seen.push(stop));
    const emit = (e: EngineEvent) => listeners.forEach((cb) => cb(e));
    const phaseEvent = (p: ExercisePhase): EngineEvent => ({
      kind: 'phase',
      phase: p,
      pose: 'open',
      rep: 1,
      index: exercise.index,
    });
    emit(phaseEvent('ASSIST'));
    emit({ kind: 'resistance', finger: 'index', ma: 1037 });
    emit(phaseEvent('ASSIST_HOLD'));
    emit(phaseEvent('RELEASE'));
    emit(phaseEvent('PAUSED'));
    exercise.index = 3;
    emit(phaseEvent('PRESENT'));
    expect(seen).toEqual([{ index: 2, finger: 'index' }, null, null]);
  });

  it('says it, marks the finger, skips "Hold it" and never says the glove helped', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
    mount(<Exercise />, runtime);
    await waitFor(() =>
      expect(document.querySelector('.live-details')).not.toBeNull(),
    );
    // The scripted glove helps, then meets resistance in the index.
    until(runtime, () => phase(runtime) === 'ASSIST');
    until(runtime, () => heading().textContent!.includes('Stopped'));
    expect(heading()).toHaveTextContent('Stopped — resistance in your index');
    expect(heading()).toHaveClass('instruction--caution');
    expect(
      screen.getByText('The glove stopped pulling. Relax your hand.'),
    ).toBeVisible();
    expect(screen.getByText('Glove stopped', { selector: 'strong' })).toBeVisible();
    expect(document.querySelector('.ds-ring--caution')).not.toBeNull();
    expect(gauge('Index')).toHaveAttribute('data-state', 'stopped');
    for (const name of ['Thumb', 'Middle', 'Ring', 'Pinky'])
      expect(gauge(name)).not.toHaveAttribute('data-state', 'assist');
    expect(hand.state?.('index')).toBe('stopped');
    expect(hand.state?.('middle')).toBe('idle');

    // The glove keeps what it reached for a moment: no hold countdown.
    until(runtime, () => phase(runtime) === 'ASSIST_HOLD');
    expect(heading()).toHaveTextContent('Stopped — resistance in your index');
    expect(document.querySelector('.phase-ring__count')).toBeNull();
    expect(screen.queryByText('Hold it')).toBeNull();

    until(runtime, () => phase(runtime) === 'RELEASE');
    expect(heading()).toHaveTextContent('Stopped — resistance in your index');

    until(runtime, () => phase(runtime) === 'REST');
    expect(heading()).toHaveTextContent('We stopped to keep your index safe');
    expect(
      screen.getByText('Good effort. We stopped to keep your index safe.'),
    ).toBeVisible();
    const live = document.querySelector('.exercise-live')!.textContent!;
    expect(live).not.toMatch(/glove helped\. good effort|helped with the rest/i);
    expect(live).not.toMatch(/\bmA\b/);
    expect(document.querySelector('.success-tick')).toBeNull();
  }, PAGE_TIMEOUT);

  it('keeps the regular glove-help path unchanged', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
    // Without the scripted resistance event this is a plain glove-helped attempt.
    const exercise = runtime.exercise;
    const onEvent = exercise.onEvent.bind(exercise);
    exercise.onEvent = (cb) =>
      onEvent((e) => {
        if (e.kind !== 'resistance') cb(e);
      });
    mount(<Exercise />, runtime);
    until(runtime, () => phase(runtime) === 'ASSIST_HOLD');
    expect(heading()).toHaveTextContent('Hold it');
    expect(document.querySelector('.phase-ring__count')).not.toBeNull();
    until(runtime, () => phase(runtime) === 'RELEASE');
    expect(heading()).toHaveTextContent('Relax your hand');
    expect(screen.queryByText('Make a full fist')).toBeNull();
  }, PAGE_TIMEOUT);
});
