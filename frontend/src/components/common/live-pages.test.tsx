import { Profiler, type ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { VoiceProvider } from '../../voice';
import Home from '../../pages/Home';
import Setup from '../../pages/Setup';
import Exercise from '../../pages/Exercise';
import Evaluate from '../../pages/Evaluate';
import Calibrate from '../../pages/Calibrate';
import {
  GloveChip,
  SafetyBanner,
  ConfirmDialog,
  PhaseRing,
  phaseLabels,
  SessionSummaryCard,
} from './index';
import { server } from '../../mocks/server';
import { resetMocks } from '../../mocks/handlers';
import {
  DEFAULT_EXERCISE_SETTINGS,
  DEFAULT_EVAL_SETTINGS,
} from '../../contracts/poses';
import type { EngineEvent } from '../../contracts/engine';
import { http, HttpResponse } from 'msw';
import { sessions, profile } from '../../contracts/fixtures.check';
const handRender = vi.hoisted(() => vi.fn());
vi.mock('../../hand3d/VirtualHand', () => ({
  VirtualHand: () => {
    handRender();
    return <div>Hand preview</div>;
  },
}));
vi.mock('../../vision/CameraOverlay', () => ({
  CameraOverlay: () => <div>Camera preview</div>,
}));
const nativeFetch = globalThis.fetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  const intercepted = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    intercepted(
      typeof input === 'string'
        ? new URL(input, window.location.origin)
        : input,
      init,
    ),
  );
});
beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  resetMocks();
  server.resetHandlers();
  sessionStorage.clear();
  handRender.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(() => {
  server.close();
  vi.stubGlobal('fetch', nativeFetch);
});
function mount(
  children: ReactNode,
  runtime = new ScriptedRuntime({ persist: false }),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
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
  return { ...view, runtime };
}
async function startExercise(runtime: ScriptedRuntime) {
  await act(async () => {
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
  });
}
describe('Home and Setup', () => {
  it('loads greeting, labeled demo history and starts the short plan', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'performance'],
    });
    server.use(
      http.get('*/api/profile', () =>
        HttpResponse.json({ ...profile, pseudonym: 'Alex' }),
      ),
      http.get('*/api/sessions', () =>
        HttpResponse.json(sessions.map((s) => ({ ...s, is_demo: true }))),
      ),
    );
    const { runtime } = mount(<Home />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(
      await screen.findByRole('heading', { name: /Hello, / }),
    ).toBeVisible();
    expect(await screen.findByText('Demo data')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Short session (1 rep each)'));
    fireEvent.click(
      screen.getByRole('button', { name: "Start today's practice" }),
    );
    await waitFor(() => expect(runtime.exercise.view().total).toBe(5));
  });
  it('routes uncalibrated practice to calibration', () => {
    const runtime = new ScriptedRuntime({ persist: false });
    runtime.calibration.current = null;
    mount(
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/calibrate" element={<p>Calibration destination</p>} />
      </Routes>,
      runtime,
    );
    expect(screen.getByText(/Calibration needed/)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: "Start today's practice" }),
    );
    expect(screen.getByText('Calibration destination')).toBeVisible();
  });
  it('shows diagnostics, disconnects and reconnects the simulator, and reports unsupported real sources', async () => {
    mount(<Setup />);
    expect(screen.getByRole('heading', { name: 'Glove ready' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(
      await screen.findByRole('heading', { name: 'Glove not connected' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use simulator' }));
    expect(
      await screen.findByRole('heading', { name: 'Glove ready' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect glove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use Chrome or Edge for the glove',
    );
    fireEvent.click(screen.getByText('Glove diagnostics'));
    expect(screen.getByText(/State:/)).toBeVisible();
  });
});
describe('Exercise', () => {
  it('validates an empty plan and observation-only start', () => {
    mount(<Exercise />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Observation only/ }));
    for (const name of [
      'Open hand',
      'Hook',
      'Tabletop',
      'Straight fist',
      'Full fist',
    ])
      fireEvent.click(screen.getByRole('checkbox', { name }));
    expect(
      screen.getByRole('button', { name: 'Start practice' }),
    ).toBeDisabled();
  });
  it('renders all phase labels and summary, with frame updates isolated from the hand', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
    const durations: number[] = [];
    mount(
      <Profiler
        id="exercise"
        onRender={(_, phase, duration) => {
          if (phase === 'update') durations.push(duration);
        }}
      >
        <Exercise />
      </Profiler>,
      runtime,
    );
    await waitFor(() =>
      expect(screen.getAllByRole('meter')[0]).toHaveAttribute('aria-valuenow'),
    );
    const initialRenders = handRender.mock.calls.length;
    for (let i = 0; i < 40; i++) act(() => runtime.advance(0.05));
    expect(handRender).toHaveBeenCalledTimes(initialRenders);
    const timings = durations.slice(5).sort((a, b) => a - b);
    console.info(
      `WP7 React profiler: ${timings.length} frame updates, median=${timings[Math.floor(timings.length / 2)]?.toFixed(3)}ms, max=${timings.at(-1)?.toFixed(3)}ms`,
    );
    for (const phase of Object.keys(
      phaseLabels,
    ) as (keyof typeof phaseLabels)[]) {
      if (phase === 'DONE') continue;
      act(() =>
        runtime.exerciseStore.setState({ phase, paused: phase === 'PAUSED' }),
      );
      expect(
        screen.getByText(
          phase === 'PRESENT'
            ? /Get ready|Show me your hand/
            : phaseLabels[phase],
          { selector: 'strong' },
        ),
      ).toBeVisible();
    }
    act(() =>
      runtime.exerciseStore.setState({
        phase: 'DONE',
        summary: sessions[0].summary,
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'Session complete' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Practice again' }));
    expect(
      screen.getByRole('button', { name: 'Start practice' }),
    ).toBeVisible();
  });
  it('Space pauses/resumes, S skips, Escape confirms; shortcuts ignore controls', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    mount(<Exercise />, runtime);
    await startExercise(runtime);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(runtime.exercise.view().paused).toBe(true);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(runtime.exercise.view().phase).toBe('RELEASE');
    const skip = vi.spyOn(runtime.exercise, 'skip');
    fireEvent.keyDown(window, { key: 's' });
    expect(skip).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Skip pose' }), {
      key: 's',
    });
    expect(skip).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep practicing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Session complete' }),
      ).toBeVisible(),
    );
  });
  it('stops on route departure and prevents browser unload while active', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    mount(
      <>
        <Link to="/away">Leave page</Link>
        <Routes>
          <Route path="/" element={<Exercise />} />
          <Route path="/away" element={<p>Away</p>} />
        </Routes>
      </>,
      runtime,
    );
    await startExercise(runtime);
    const stop = vi.spyOn(runtime.exercise, 'stop');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    await startExercise(runtime);
    fireEvent.click(screen.getByText('Leave page'));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    expect(runtime.exercise.view().phase).toBe('DONE');
  });
});
describe('Safety and accessible common controls', () => {
  it.each([
    'overcurrent',
    'stop_button',
    'watchdog',
    'camera_lost',
    'glove_disconnected',
  ] as const)(
    'shows %s safety, focuses Resume and calls runtime resume',
    async (source) => {
      const runtime = new ScriptedRuntime({ persist: false });
      let emit: (event: EngineEvent) => void = () => {};
      vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
        emit = cb;
        return () => {};
      });
      const resume = vi.spyOn(runtime.exercise, 'resume');
      mount(<SafetyBanner />, runtime);
      act(() => emit({ kind: 'safety', source, finger: 'index', ma: 950 }));
      expect(screen.getByRole('alert')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Resume' })).toHaveFocus();
      fireEvent.click(screen.getByText('What happened?'));
      expect(screen.getByText(/950 mA/)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(resume).toHaveBeenCalledOnce();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Releasing the glove…',
      );
      act(() => runtime.exerciseStore.setState({ phase: 'REST' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('retains missing data as a gap and shows previous-session deltas', () => {
    mount(
      <SessionSummaryCard
        summary={{
          ...sessions[0].summary!,
          per_finger: [
            {
              finger: 'index',
              active_max_mean: null,
              assist_needed_mean: null,
            },
          ],
          previous: {
            active_ratio_mean: 0.5,
            per_finger: [{ finger: 'index', active_max_mean: 0.5 }],
          },
        }}
      />,
    );
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.queryByText(/vs last time/)).not.toBeInTheDocument();
  });
  it('focuses the safe dialog choice and offers cancellation', () => {
    const cancel = vi.fn();
    mount(
      <ConfirmDialog title="Finish?" onConfirm={vi.fn()} onCancel={cancel} />,
    );
    const keep = screen.getByRole('button', { name: 'Keep practicing' });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('shows a green Ready chip and a neutral Paused chip', async () => {
    const { runtime } = mount(<GloveChip />);
    expect(screen.getByText('Ready').closest('.ds-status-chip')).toHaveClass(
      'ds-status-chip--reached',
    );
    act(() =>
      runtime.exerciseStore.setState({ phase: 'PAUSED', paused: true }),
    );
    expect(screen.getByText('Paused').closest('.ds-status-chip')).toHaveClass(
      'ds-status-chip--neutral',
    );
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });
  it('announces waiting for a visible hand', () => {
    mount(<PhaseRing phase="PRESENT" elapsed={0} duration={3} waiting />);
    expect(screen.getByText('Show me your hand')).toBeVisible();
  });
});
describe('Calibration wizard', () => {
  it('validates each range and resumes after leaving', () => {
    const first = mount(<Calibrate />);
    expect(screen.getByText('Hand relaxed. Stop if it hurts.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Set open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set closed' }));
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Servo angle'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Set closed/ }));
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeEnabled();
    first.unmount();
    mount(<Calibrate />);
    expect(screen.getByRole('button', { name: /Set open ✓ 90/ })).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Set closed ✓ 120/ }),
    ).toBeVisible();
  });
  it('completes three fingers, example camera, friction skip, review and save', async () => {
    mount(<Calibrate />);
    for (const finger of ['Thumb', 'Index', 'Middle']) {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${finger} ·`) }),
      );
      fireEvent.change(screen.getByLabelText('Servo angle'), {
        target: { value: '20' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Set open/ }));
      fireEvent.change(screen.getByLabelText('Servo angle'), {
        target: { value: '150' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Set closed/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send glove ranges' }));
    expect(
      await screen.findByRole('heading', { name: 'Step 2 · Camera range' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue to friction' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: /Use example camera range/ }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to friction' }),
    );
    expect(
      screen.getByRole('button', { name: 'Measure glove friction' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Skip friction measurement' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Review your range' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Current limit (mA)'), {
      target: { value: '1500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Complete each calibration step',
    );
    fireEvent.change(screen.getByLabelText('Current limit (mA)'), {
      target: { value: '900' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    expect(
      await screen.findByRole('heading', { name: 'Your range is saved' }),
    ).toBeVisible();
  });
});
describe('Evaluation', () => {
  it('requires the checklist, renders live sweep, results and safe abort', async () => {
    const { runtime } = mount(<Evaluate />);
    expect(
      screen.getByRole('button', { name: 'Start evaluation' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('checkbox', { name: 'Calibrated' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Glove connected' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Hand relaxed in the glove'));
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Measuring thumb' }),
      ).toBeVisible(),
    );
    runtime.dispose();
    act(() => runtime.advance(1));
    expect(
      screen.getByRole('img', {
        name: 'Resistance estimate by finger position',
      }),
    ).toBeVisible();
    for (let i = 0; i < 100; i++) act(() => runtime.advance(0.5));
    expect(
      screen.getByRole('heading', { name: 'Your evaluation' }),
    ).toBeVisible();
    expect(
      screen.getByText('An estimate inspired by clinical practice.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate again' }));
    fireEvent.click(screen.getByLabelText('Hand relaxed in the glove'));
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop evaluation' }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop evaluation' }));
    expect(
      await screen.findByText('Evaluation stopped. Rest before trying again.'),
    ).toBeVisible();
  });
  it('shows unavailable measurements and a safe stopped badge', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.evaluation.start(DEFAULT_EVAL_SETTINGS);
    runtime.dispose();
    for (let i = 0; i < 100; i++) runtime.advance(0.5);
    const result = runtime.evaluation.view().result!;
    runtime.evaluationStore.setState({
      result: {
        ...result,
        friction_used: false,
        fingers: result.fingers.map((f) => ({
          ...f,
          aborted: true,
          resistance_fast_ma: null,
          velocity_dependence_ma: null,
        })),
        sweeps: result.sweeps.map((s) => ({ ...s, aborted_at: 0.3 })),
      },
    });
    mount(<Evaluate />, runtime);
    expect(screen.getAllByText('Stopped safely at 30%')).toHaveLength(3);
    expect(screen.getAllByText(/Unavailable/)).toHaveLength(6);
  });
});
