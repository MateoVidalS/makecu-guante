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
    fireEvent.click(screen.getByRole('button', { name: 'Active range' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Pose' }), {
      target: { value: 'full_fist' },
    });
    const tables = await screen.findAllByText('Show as table');
    fireEvent.click(tables[1]);
    expect(screen.getAllByRole('table', { hidden: true })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(within(table).queryAllByText('Loading…')).toHaveLength(0),
    );
    expect(within(table).getAllByText('Demo data')).toHaveLength(
      mockState.sessions.filter((s) => s.is_demo).length,
    );
    expect(within(table).getAllByRole('row')).toHaveLength(9);
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
    expect(screen.getAllByText('Show as table')).toHaveLength(3);
    expect(screen.getAllByRole('table')[0]).toHaveTextContent('mA');
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
    fireEvent.click(generate);
    expect(
      await screen.findByText(
        'Summary unavailable. Check the Gemini connection and try again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
  it('provides loading and empty states in chart primitives', () => {
    const { rerender } = render(
      <FingerTrend finger="thumb" points={[]} loading />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
    rerender(<FingerTrend finger="thumb" points={[]} />);
    expect(screen.getByText('No measurements recorded yet.')).toBeVisible();
    rerender(<ReplayChart />);
    expect(screen.getByText('No measurements recorded yet.')).toBeVisible();
    rerender(<SweepCurves finger="thumb" sweeps={[]} />);
    expect(screen.getByText('No measurements recorded yet.')).toBeVisible();
  });
});
