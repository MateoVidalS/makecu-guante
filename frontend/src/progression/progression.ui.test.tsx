// Adaptive plan UI (docs/plan/17): off by default (no card), turned on by the therapist in the
// Doctor view, shown to the patient before practice, and applied (or skipped) at Start.
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
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { resetMocks } from '../mocks/handlers';
import { RuntimeProvider, ScriptedRuntime } from '../runtime';
import { DEFAULT_EXERCISE_SETTINGS } from '../contracts/poses';
import { AdaptivePlanSection } from './AdaptivePlanSection';
import { TodaysPlanCard } from './TodaysPlanCard';
import { useTodaysPlan } from './useTodaysPlan';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

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
beforeEach(() => resetMocks());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function wrap(children: ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={cache}>
      {/* Scripted runtime: simulated glove and camera, so the demo history is the cohort. */}
      <RuntimeProvider runtime={new ScriptedRuntime({ persist: false })}>
        {children}
      </RuntimeProvider>
    </QueryClientProvider>
  );
}

let started: unknown[] = [];
function Practice() {
  const today = useTodaysPlan();
  const [use, setUse] = useState(true);
  return (
    <>
      <TodaysPlanCard today={today} use={use} onUseChange={setUse} />
      <button
        type="button"
        onClick={() =>
          started.push(today.apply(DEFAULT_EXERCISE_SETTINGS, { skip: !use }))
        }
      >
        Start
      </button>
    </>
  );
}

describe('adaptive plan', () => {
  beforeEach(() => {
    started = [];
  });

  it('is off by default: no card and the standard settings', async () => {
    render(wrap(<Practice />));
    // Let the settings query settle before starting.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Today's plan")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(started[0]).toBe(DEFAULT_EXERCISE_SETTINGS);
  });

  it('the therapist turns it on, the patient sees and uses today’s plan', async () => {
    render(
      wrap(
        <>
          <AdaptivePlanSection />
          <Practice />
        </>,
      ),
    );
    // Doctor view: a preview of what the plan would set, while it is still off.
    expect(await screen.findByText(/Preview if turned on/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', {
      name: 'Adapt practice to recent progress',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText(/Next practice/)).toBeInTheDocument();

    // Practice screen: the card lists the eased fingers (demo patient: pinky opens ~30% alone).
    expect(await screen.findByText("Today's plan")).toBeInTheDocument();
    expect(await screen.findByText(/aim for 60%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(started[0]).toMatchObject({
      attempt_s: DEFAULT_EXERCISE_SETTINGS.attempt_s,
      progression: { target_scale: { pinky: 0.6 }, challenge: 'standard' },
    });

    // The patient can use the standard plan today instead.
    fireEvent.click(screen.getByRole('switch', { name: "Use today's plan" }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(started[1]).toBe(DEFAULT_EXERCISE_SETTINGS);
  });
});
