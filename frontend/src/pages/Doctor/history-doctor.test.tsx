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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { mockState, resetMocks } from '../../mocks/handlers';
import { getProfile } from '../../api/client';
import History from '../History';
import Profile from '../Profile';
import SessionReplay from '../SessionReplay';
import EvaluationDetail from '../EvaluationDetail';
import Doctor from './index';
import { FingerTrend, ReplayChart, SweepCurves } from '../../components/charts';

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
beforeEach(() => {
  resetMocks();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 640,
    height: 240,
    top: 0,
    left: 0,
    right: 640,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});
function mount(path: string) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/history" element={<History />} />
          <Route path="/history/sessions/:id" element={<SessionReplay />} />
          <Route
            path="/history/evaluations/:id"
            element={<EvaluationDetail />}
          />
          <Route path="/profile" element={<Profile />} />
          <Route path="/doctor" element={<Doctor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('record review pages', () => {
  it('shows fixture improvement, pose selection, accessible tables, and session safety counts', async () => {
    mount('/history');
    expect(await screen.findByText('35% → 63%')).toBeVisible();
    expect(
      screen.getByRole('img', { name: /Hand map, first session/ }),
    ).toHaveAccessibleName(/Thumb 35% then, 63% now/);
    expect(
      await screen.findByRole('img', { name: /Latest session per finger/ }),
    ).toHaveAccessibleName(/Index 65% on your own and 35% from the glove/);
    expect(
      screen.getByRole('img', { name: /Practice calendar/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Active range' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Pose' }), {
      target: { value: 'full_fist' },
    });
    const tables = await screen.findAllByText('Show as table');
    fireEvent.click(tables[1]);
    expect(screen.getAllByRole('table', { hidden: true })).toHaveLength(5);
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(within(table).queryAllByText('Loading…')).toHaveLength(0),
    );
    expect(within(table).getAllByText('Demo data')).toHaveLength(
      mockState.sessions.filter((s) => s.is_demo).length,
    );
    expect(within(table).getAllByRole('row')).toHaveLength(9);
  });
  it('labels missing latest ring/pinky effort instead of showing an older session', async () => {
    const latest = mockState.sessions.reduce((a, b) =>
      a.started_at > b.started_at ? a : b,
    );
    latest.summary!.per_finger = latest.summary!.per_finger.filter(
      (f) => f.finger !== 'ring' && f.finger !== 'pinky',
    );
    mount('/history');
    const bars = await screen.findByRole('img', {
      name: /Latest session per finger/,
    });
    expect(bars).toHaveAccessibleName(/Ring Not measured.*Pinky Not measured/);
    expect(within(bars).getAllByText('Not measured')).toHaveLength(2);
    for (const finger of ['Ring', 'Pinky']) {
      const row = within(bars).getByText(finger).closest('.effort-bars__row')!;
      expect(row.querySelectorAll('.effort-bars__seg')).toHaveLength(0);
    }
  });
  it.each(['absent', 'null'] as const)(
    'keeps legacy %s replay fingers visible as not measured',
    async (kind) => {
      const attempt = mockState.details[8].attempts[0];
      attempt.fingers = attempt.fingers.flatMap((f) => {
        if (f.finger !== 'ring' && f.finger !== 'pinky') return [f];
        return kind === 'absent'
          ? []
          : [
              {
                ...f,
                scored: false,
                target: null,
                active_max: null,
                assist_needed: null,
                final: null,
              },
            ];
      });
      const trace = mockState.traces[attempt.id];
      for (const finger of ['ring', 'pinky'] as const) {
        trace.closure[finger] = trace.t.map(() => null);
        // F5 returns empty servo arrays for legacy fingers.
        trace.servo[finger] = [];
      }
      mount('/history/sessions/8');
      const table = await screen.findByRole('table', {
        name: 'Per-finger estimates from the camera',
      });
      for (const finger of ['Ring', 'Pinky']) {
        const row = within(table).getByRole('row', {
          name: new RegExp(finger),
        });
        expect(row).toHaveTextContent('Not measured');
        expect(row).not.toHaveTextContent('0%');
      }
      expect(
        screen.getByRole('img', { name: /Hand map for this attempt/ }),
      ).toHaveAccessibleName(/Ring: Not measured.*Pinky: Not measured/);
    },
  );
  it('shows unmeasured evaluation fingers without claiming complete sweeps', async () => {
    const evaluation = mockState.evaluations[0];
    evaluation.fingers = evaluation.fingers.filter(
      (f) => f.finger !== 'ring' && f.finger !== 'pinky',
    );
    evaluation.sweeps = evaluation.sweeps.filter(
      (f) => f.finger !== 'ring' && f.finger !== 'pinky',
    );
    mount(`/history/evaluations/${evaluation.id}`);
    const table = await screen.findByRole('table', {
      name: /Mean excess current over 20–90% commanded position/,
    });
    for (const finger of ['Ring', 'Pinky']) {
      const row = within(table).getByRole('row', { name: new RegExp(finger) });
      expect(row).toHaveTextContent('Not measured');
      expect(row).not.toHaveTextContent('Complete');
    }
  });
  it('loads and saves the optional profile', async () => {
    mount('/profile');
    const name = await screen.findByLabelText('Pseudonym');
    fireEvent.change(name, { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Affected hand'), {
      target: { value: 'left' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile saved.')).toBeVisible();
    expect(await getProfile()).toMatchObject({
      pseudonym: 'Alex',
      affected_hand: 'left',
    });
  });
  it('requires explicit confirmation for cascade deletion, then returns to history', async () => {
    mount('/history/sessions/8');
    expect(
      await screen.findByText('Your attempt, moment by moment'),
    ).toBeVisible();
    expect(
      await screen.findByRole('img', { name: /Attempt phases: On your own/ }),
    ).toHaveAccessibleName(/1 safety event marked/);
    expect(
      screen.getByRole('img', { name: /Hand map for this attempt/ }),
    ).toHaveAccessibleName(/Index: 65% on your own, glove added 35%/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(mockState.details[8]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Keep session' }));
    expect(mockState.details[8]).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(
      await screen.findByRole('heading', { name: 'History' }),
    ).toBeVisible();
    expect(mockState.details[8]).toBeUndefined();
    expect(mockState.traces[1]).toBeUndefined();
  });
  it('explains missing records instead of displaying fabricated data', async () => {
    mount('/history/evaluations/999');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Records are unavailable',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('shows evaluation curves, units, and the friction caveat', async () => {
    mockState.evaluations[0].friction_used = false;
    mount(`/history/evaluations/${mockState.evaluations[0].id}`);
    expect(await screen.findByText(/No friction calibration/)).toBeVisible();
    // Resistance dumbbells plus one sweep chart per finger, each with a table twin.
    expect(screen.getAllByText('Show as table')).toHaveLength(6);
    expect(screen.getAllByRole('table')[0]).toHaveTextContent('mA');
    expect(
      await screen.findByRole('img', { name: /Resistance per finger/ }),
    ).toBeInTheDocument();
  });
  it('renders doctor review and handles an unavailable therapist summary', async () => {
    server.use(
      http.post('/api/summaries', () =>
        HttpResponse.json(
          { error: { code: 'ai_unavailable', message: 'No key' } },
          { status: 503 },
        ),
      ),
    );
    mount('/doctor');
    const generate = await screen.findByRole('button', {
      name: 'Generate (last 7 days)',
    });
    await waitFor(() => expect(generate).toBeEnabled());
    expect(await screen.findByText('Active range over sessions')).toBeVisible();
    expect(screen.getByText('At a glance')).toBeVisible();
    expect(
      await screen.findByText(
        'Speed-dependent resistance eased on every finger',
      ),
    ).toBeVisible();
    fireEvent.click(generate);
    expect(
      await screen.findByText(
        'Summary unavailable. Check the Gemini connection and try again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
  it('draws complete sweep curves when speeds have different position samples', async () => {
    render(
      <SweepCurves
        finger="index"
        sweeps={[
          {
            finger: 'index',
            speed: 'slow',
            v: 0.2,
            aborted_at: null,
            points: [
              { pos: 0, ma: 100, excess_ma: 20 },
              { pos: 0.5, ma: 200, excess_ma: 100 },
              { pos: 1, ma: 300, excess_ma: 180 },
            ],
          },
          {
            finger: 'index',
            speed: 'fast',
            v: 1,
            aborted_at: null,
            points: [
              { pos: 0.1, ma: 110, excess_ma: 20 },
              { pos: 0.6, ma: 250, excess_ma: 150 },
              { pos: 0.9, ma: 350, excess_ma: 230 },
            ],
          },
        ]}
      />,
    );
    await waitFor(() => {
      const paths = document.querySelectorAll('.recharts-line-curve');
      expect(paths).toHaveLength(4);
      paths.forEach((p) => expect(p.getAttribute('d')).toMatch(/L/));
    });
  });
  it('provides loading and empty states in chart primitives', () => {
    const { rerender } = render(
      <FingerTrend finger="thumb" points={[]} loading />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
    rerender(<FingerTrend finger="thumb" points={[]} />);
    expect(
      screen.getByText('Not measured. No measurements recorded yet.'),
    ).toBeVisible();
    rerender(<ReplayChart />);
    expect(
      screen.getByText('Not measured. No measurements recorded yet.'),
    ).toBeVisible();
    rerender(<SweepCurves finger="thumb" sweeps={[]} />);
    expect(
      screen.getByText('Not measured. No measurements recorded yet.'),
    ).toBeVisible();
  });
});
