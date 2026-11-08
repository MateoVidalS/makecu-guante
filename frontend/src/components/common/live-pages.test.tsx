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
import { GloveProvider, useGlove } from '../../glove';
import { VisionProvider } from '../../vision';
import { VoiceProvider } from '../../voice';
import Home from '../../pages/Home';
import Setup from '../../pages/Setup';
import Exercise from '../../pages/Exercise';
import Evaluate from '../../pages/Evaluate';
import Calibrate from '../../pages/Calibrate';
import { helperRuntime as legacyHelperRuntime } from '../calibration/testSupport';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../../contracts/calibration';
import { freshDraft, loadDraft, saveDraft } from '../../pages/Calibrate/draft';
import { RuntimeFallbackControls } from '../../runtime/FallbackControls';
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
import { PreflightGloveControls } from './preflightTestSupport';
import { PRACTICE_PREFLIGHT_MESSAGE } from './preflight';
const handRender = vi.hoisted(() => vi.fn());
function helperRuntime() {
  const runtime = legacyHelperRuntime();
  runtime.calibration.current!.camera.camera_view = CURRENT_CAMERA_VIEW;
  runtime.calibration.current!.camera.flex_model = CURRENT_FLEX_MODEL;
  return runtime;
}
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
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
  saveDraft(freshDraft());
  localStorage.clear();
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
function mount(children: ReactNode, runtime = helperRuntime()) {
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
  it('keeps demo recovery out of an ordinary hardware session', () => {
    vi.stubEnv('VITE_SIM', '0');
    vi.stubEnv('VITE_DEMO', '0');
    mount(<RuntimeFallbackControls />);
    expect(screen.queryByText('Demo tools')).toBeNull();
  });

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
    await waitFor(() => expect(runtime.exercise.view().total).toBe(10));
  });
  it('opens Customize plan after an earlier session has finished', () => {
    const runtime = new ScriptedRuntime({ persist: false });
    runtime.exerciseStore.setState({ summary: sessions[0].summary });
    mount(
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/exercise" element={<Exercise />} />
      </Routes>,
      runtime,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Customize plan' }));
    expect(
      screen.getByRole('heading', { name: 'Your practice' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Session complete' }),
    ).toBeNull();
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
  it('surfaces the incompatible firmware error from a board with three fingers', async () => {
    const close = vi.fn(async () => {});
    const port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ t: 'info', fingers: 3 }) + '\n',
            ),
          );
        },
      }),
      writable: new WritableStream<Uint8Array>(),
      open: vi.fn(async () => {}),
      close,
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { getPorts: async () => [], requestPort: async () => port },
    });
    try {
      mount(<Setup />);
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect glove' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This glove reports 3 fingers. memo requires 5-finger firmware.',
      );
      expect(
        screen.queryByRole('heading', { name: 'Glove ready' }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(close).toHaveBeenCalled());
    } finally {
      Reflect.deleteProperty(navigator, 'serial');
    }
  });
  it('shows diagnostics, disconnects and reconnects the simulator, and reports unsupported real sources', async () => {
    mount(
      <>
        <RuntimeFallbackControls />
        <Setup />
      </>,
    );
    fireEvent.click(screen.getByText('Advanced', { exact: true }));
    expect(screen.getByRole('heading', { name: 'Glove ready' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(
      await screen.findByRole('heading', { name: 'Glove not connected' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Connect glove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use Chrome or Edge for the glove',
    );

    expect(screen.getByText('Telemetry age')).toBeVisible();
  });
});
describe('Exercise', () => {
  it('offers compact presets without timing, repetitions or observation controls', () => {
    const { runtime } = mount(<Exercise />);
    expect(
      screen.queryByRole('checkbox', { name: /Observation only/ }),
    ).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fist only, 1 rep' }));
    const start = vi.spyOn(runtime.exercise, 'start');
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(start).toHaveBeenCalledWith(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
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
  it('closes demo and coach popovers before focusing a safety Resume', () => {
    const runtime = new ScriptedRuntime({ persist: false });
    let emit: (event: EngineEvent) => void = () => {};
    vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((callback) => {
      emit = callback;
      return () => {};
    });
    mount(
      <>
        <details open data-safety-popover>
          <summary>Demo tools</summary>Controls
        </details>
        <SafetyBanner />
      </>,
      runtime,
    );
    act(() =>
      emit({ kind: 'safety', source: 'stop_button', finger: null, ma: null }),
    );
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveFocus();
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
    const runtime = new ScriptedRuntime({ persist: false });
    let emit: (event: EngineEvent) => void = () => {};
    vi.spyOn(runtime.exercise, 'onEvent').mockImplementation((cb) => {
      emit = cb;
      return () => {};
    });
    mount(<GloveChip />, runtime);
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
    act(() =>
      emit({ kind: 'safety', source: 'camera_lost', finger: null, ma: null }),
    );
    expect(screen.getByText('Stopped').closest('.ds-status-chip')).toHaveClass(
      'ds-status-chip--danger',
    );
    act(() => runtime.exerciseStore.setState({ phase: 'REST', paused: false }));
    expect(screen.getByText('Ready')).toBeVisible();
  });
  it('announces waiting for a visible hand', () => {
    mount(<PhaseRing phase="PRESENT" elapsed={0} duration={3} waiting />);
    expect(screen.getByText('Show me your hand')).toBeVisible();
  });
});
describe('Calibration wizard', () => {
  function freshRuntime() {
    const runtime = helperRuntime();
    runtime.calibration.current = null;
    return runtime;
  }
  it('names the safety event that stopped a camera-range capture', () => {
    function StopGlove() {
      const { world } = useGlove();
      return (
        <button onClick={() => world.controls.pressStop()}>Trip STOP</button>
      );
    }
    mount(
      <>
        <Calibrate />
        <StopGlove />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trip STOP' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Glove stopped. STOP button pressed.',
    );
    expect(
      screen.getByRole('button', { name: 'Release glove now' }),
    ).toBeVisible();
  });

  it('validates each range and resumes after leaving', () => {
    const first = mount(<Calibrate />, freshRuntime());
    expect(
      screen.getByText(
        /For each finger, set two motor positions: slack with a relaxed fist/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Set slack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set open' }));
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Servo angle'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Set open/ }));
    expect(screen.getByRole('button', { name: 'Next finger' })).toBeEnabled();
    first.unmount();
    mount(<Calibrate />, freshRuntime());
    expect(screen.getByText('Slack at 90°')).toBeVisible();
    expect(screen.getByText('Open at 120°')).toBeVisible();
  });
  it('sends five ranges automatically, reviews captures and starts the default plan', async () => {
    const first = mount(<Calibrate />, freshRuntime());
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${finger} ·`) }),
      );
      fireEvent.change(screen.getByLabelText('Servo angle'), {
        target: { value: '20' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Set slack/ }));
      fireEvent.change(screen.getByLabelText('Servo angle'), {
        target: { value: '150' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Set open/ }));
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to camera range' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Step 2 · Camera range' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Capture pinch' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Continue to review' }),
    ).toBeDisabled();
    // Captures survive route departure; review resumes with those measured values.
    const camera = helperRuntime().calibration.current!.camera;
    saveDraft({
      ...loadDraft(),
      step: 2,
      open: { raw: camera.open_flex, pinch: camera.pinch_open },
      closed: { raw: camera.closed_flex, pinch: camera.pinch_closed },
    });
    first.unmount();
    const { runtime } = mount(<Calibrate />, freshRuntime());
    expect(
      screen.getByRole('heading', { name: 'Review your range' }),
    ).toBeVisible();
    fireEvent.click(screen.getByText('Advanced', { exact: true }));
    fireEvent.change(screen.getByLabelText('Current limit (mA)'), {
      target: { value: '2201' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Complete each calibration step',
    );
    fireEvent.change(screen.getByLabelText('Current limit (mA)'), {
      target: { value: '1500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
    expect(
      await screen.findByRole('heading', { name: 'Your range is saved' }),
    ).toBeVisible();
    const start = vi.spyOn(runtime.exercise, 'start');
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(start).toHaveBeenCalledWith(
      expect.arrayContaining([
        { pose: 'full_fist', reps: 1 },
        { pose: 'open', reps: 1 },
      ]),
      DEFAULT_EXERCISE_SETTINGS,
    );
    expect(runtime.calibration.current!.friction).toEqual({});
  });
});
describe('practice preflight at every entry point', () => {
  const entryPoints = [
    { name: 'Home', Page: Home, startLabel: "Start today's practice" },
    { name: 'Calibrate', Page: Calibrate, startLabel: 'Start practice' },
    { name: 'Exercise', Page: Exercise, startLabel: 'Start practice' },
  ];
  function mountEntry(Page: typeof Home, runtime: ScriptedRuntime) {
    vi.spyOn(runtime.calibration, 'save').mockImplementation(async (value) => {
      const saved = { ...value, id: 99, created_at: new Date().toISOString() };
      runtime.calibration.current = saved;
      return saved;
    });
    const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
    mount(
      <>
        <PreflightGloveControls />
        <Link to="/">Return to practice start</Link>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/exercise" element={<p>Exercise destination</p>} />
        </Routes>
      </>,
      runtime,
    );
    return start;
  }
  async function prepare(name: string) {
    if (name === 'Calibrate') {
      fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
      await screen.findByRole('heading', { name: 'Your range is saved' });
    } else if (name === 'Home') {
      await screen.findByText('Sees the hand', { exact: true });
    }
  }
  it.each(entryPoints)(
    '$name blocks the real glove until Setup confirms both checks',
    async ({ name, Page, startLabel }) => {
      const start = mountEntry(Page, helperRuntime());
      fireEvent.click(screen.getByRole('button', { name: 'Use real glove' }));
      await prepare(name);
      fireEvent.click(screen.getByRole('button', { name: startLabel }));
      expect(start).not.toHaveBeenCalled();
      expect(
        await screen.findByRole('heading', { name: 'Before practice' }),
      ).toBeVisible();
      expect(screen.getByText(PRACTICE_PREFLIGHT_MESSAGE)).toBeVisible();
      expect(
        screen.getByRole('region', { name: 'Practice safety checks' }),
      ).toHaveFocus();
      fireEvent.change(
        screen.getByRole('combobox', {
          name: 'Were the guides re-attached since the last calibration?',
        }),
        { target: { value: 'no' } },
      );
      // One confirmation alone must still block every entry point.
      fireEvent.click(
        screen.getByRole('link', { name: 'Return to practice start' }),
      );
      await prepare(name);
      fireEvent.click(screen.getByRole('button', { name: startLabel }));
      expect(start).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'Skin under the guides and threads looks normal: no redness, marks or pain',
        }),
      );
      fireEvent.click(
        screen.getByRole('link', { name: 'Return to practice start' }),
      );
      await prepare(name);
      fireEvent.click(screen.getByRole('button', { name: startLabel }));
      await waitFor(() => expect(start).toHaveBeenCalledOnce());
    },
  );
  it.each(entryPoints)(
    '$name allows the simulated glove without confirmations',
    async ({ name, Page, startLabel }) => {
      const start = mountEntry(Page, helperRuntime());
      await prepare(name);
      fireEvent.click(screen.getByRole('button', { name: startLabel }));
      await waitFor(() => expect(start).toHaveBeenCalledOnce());
      expect(
        screen.queryByText(PRACTICE_PREFLIGHT_MESSAGE),
      ).not.toBeInTheDocument();
    },
  );
});
describe('Evaluation', () => {
  function evaluationRuntime() {
    const runtime = helperRuntime();
    runtime.calibration.current!.created_at = new Date().toISOString();
    return runtime;
  }
  it('selects only ring and pinky and numbers their four sweeps', async () => {
    const { runtime } = mount(<Evaluate />, evaluationRuntime());
    const start = vi.spyOn(runtime.evaluation, 'start');
    for (const name of ['Thumb', 'Index', 'Middle'])
      fireEvent.click(screen.getByRole('checkbox', { name }));
    expect(screen.getByText(/4 sweeps/)).toBeVisible();
    fireEvent.click(
      screen.getByLabelText(
        'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        ...DEFAULT_EVAL_SETTINGS,
        fingers: ['ring', 'pinky'],
      }),
    );
    runtime.dispose();
    act(() =>
      runtime.evaluationStore.setState({
        stage: 'sweep',
        finger: 'pinky',
        speed: 'fast',
        progress: 0.4,
      }),
    );
    expect(screen.getByText(/Sweep 4 of 4/)).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Evaluation steps' }).children,
    ).toHaveLength(4);
  });
  it('blocks an empty evaluation subset', () => {
    mount(<Evaluate />, evaluationRuntime());
    for (const name of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
      fireEvent.click(screen.getByRole('checkbox', { name }));
    fireEvent.click(
      screen.getByLabelText(
        'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      ),
    );
    expect(
      screen.getByRole('button', { name: 'Start evaluation' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Choose at least one finger to measure.'),
    ).toBeVisible();
  });
  it('requires the checklist, renders live sweep, results and safe abort', async () => {
    const { runtime } = mount(<Evaluate />, evaluationRuntime());
    expect(
      screen.getByRole('button', { name: 'Start evaluation' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('checkbox', { name: 'Calibrated' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Glove connected' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText(
        'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      ),
    );
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
        name: 'Resistance estimate by opening help',
      }),
    ).toBeVisible();
    for (let i = 0; i < 100; i++) act(() => runtime.advance(0.5));
    expect(
      screen.getByRole('heading', {
        name: 'Resistance to opening (flexor tone)',
      }),
    ).toBeVisible();
    expect(
      screen.getByText('An estimate inspired by clinical practice.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate again' }));
    fireEvent.click(
      screen.getByLabelText(
        'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await act(async () => {
      await runtime.evaluation.stop();
    });
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
    expect(screen.getAllByText('Stopped safely at 30%')).toHaveLength(5);
    expect(screen.getAllByText(/Unavailable/)).toHaveLength(10);
  });
});
