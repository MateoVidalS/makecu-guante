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
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { VoiceProvider } from '../../voice';
import {
  VoiceController,
  type VoiceDependencies,
} from '../../voice/VoiceController';
import { FakeTransport } from '../../voice/transport';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { server } from '../../mocks/server';
import { resetMocks } from '../../mocks/handlers';
import { http, HttpResponse } from 'msw';
import Exercise from '.';

vi.mock('../../hand3d/VirtualHand', () => ({
  VirtualHand: () => <div>Hand preview</div>,
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
  server.listen({ onUnhandledRequest: 'bypass' });
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
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

const GREETING = /^Let's practice together\./;

function mount(gemini: boolean) {
  const runtime = new ScriptedRuntime({ persist: false });
  const transports: FakeTransport[] = [];
  const deps: VoiceDependencies = {
    token: vi.fn().mockResolvedValue({
      token: 'auth_tokens/test',
      expires_at: '',
      model: 'test',
      voice: 'Puck',
      system_instruction: '',
      tools: [],
    }),
    sessions: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    transport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    audio: {
      open: vi.fn().mockResolvedValue(undefined),
      play: vi.fn(),
      flush: vi.fn(),
      setMuted: vi.fn(),
      close: vi.fn(),
    },
    local: {
      unlock: vi.fn(),
      tone: vi.fn(),
      speak: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Health already answered, as when coming from Home or the plan page (and refetched on mount).
  const health = { ok: true, version: '0.1.0', gemini };
  queryClient.setQueryData(['health'], health);
  server.use(http.get('*/api/health', () => HttpResponse.json(health)));
  const start = vi.spyOn(VoiceController.prototype, 'start');
  const attach = vi.spyOn(VoiceController.prototype, 'attach');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GloveProvider>
        <VisionProvider>
          <RuntimeProvider runtime={runtime}>
            <VoiceProvider dependencies={deps}>
              <MemoryRouter initialEntries={['/exercise']}>
                <Exercise />
              </MemoryRouter>
            </VoiceProvider>
          </RuntimeProvider>
        </VisionProvider>
      </GloveProvider>
    </QueryClientProvider>,
  );
  const greetings = () =>
    vi
      .mocked(deps.local.speak)
      .mock.calls.filter(([text]) => GREETING.test(text));
  return { runtime, deps, transports, start, attach, greetings, view };
}
/** Start practice from the already-open plan page; the clock is stopped so no phase cues play. */
async function startPractice(runtime: ScriptedRuntime) {
  await act(async () => {
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
  });
}
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('Exercise voice start', () => {
  it('greets once when the session id arrives a moment after practice starts', async () => {
    const s = mount(false);
    await startPractice(s.runtime);
    await wait(400);
    expect(s.start).not.toHaveBeenCalled();
    act(() => s.runtime.exerciseStore.setState({ sessionId: 41 }));
    await wait(5000);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.start).toHaveBeenCalledWith(41);
    expect(s.attach).not.toHaveBeenCalled();
    expect(s.greetings()).toHaveLength(1);
    expect(s.greetings()[0][0]).toBe(
      "Let's practice together. Make a full fist",
    );
  });
  it('starts without an id after 2 s offline, then attaches the late id without greeting again', async () => {
    const s = mount(false);
    await startPractice(s.runtime);
    await wait(1900);
    expect(s.start).not.toHaveBeenCalled();
    await wait(200);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.start).toHaveBeenCalledWith(null);
    expect(s.greetings()).toHaveLength(1);
    act(() => s.runtime.exerciseStore.setState({ sessionId: 42 }));
    await wait(5000);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.attach).toHaveBeenCalledTimes(1);
    expect(s.attach).toHaveBeenCalledWith(42);
    expect(s.greetings()).toHaveLength(1);
  });
  it('connects Gemini Live once, with the session id', async () => {
    const s = mount(true);
    await startPractice(s.runtime);
    await wait(300);
    act(() => s.runtime.exerciseStore.setState({ sessionId: 43 }));
    await wait(5000);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.deps.token).toHaveBeenCalledTimes(1);
    expect(s.deps.token).toHaveBeenCalledWith(43);
    expect(s.transports).toHaveLength(1);
    expect(
      s.transports[0].texts.filter((t) => t.text.includes('Starting')),
    ).toHaveLength(1);
  });
  it('starts again for the next session, once', async () => {
    const s = mount(false);
    await startPractice(s.runtime);
    act(() => s.runtime.exerciseStore.setState({ sessionId: 44 }));
    await wait(100);
    act(() => s.runtime.exerciseStore.setState({ phase: 'DONE' }));
    await wait(100);
    await startPractice(s.runtime);
    act(() => s.runtime.exerciseStore.setState({ sessionId: 45 }));
    await wait(5000);
    expect(s.start.mock.calls).toEqual([[44], [45]]);
    expect(s.greetings()).toHaveLength(2);
  });
});
