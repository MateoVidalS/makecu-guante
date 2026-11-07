import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { therapyTrend, TherapyReview } from './TherapyReview';
import type { TherapySession } from '../../components/therapy/data';
import { FakeTherapy } from '../../components/therapy/testing/FakeTherapy';

// The chart's geometry is covered in the browser; keep these tests on data and states.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: () => <svg />,
  CartesianGrid: () => null,
  Line: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function session(
  id: number,
  feelings: TherapySession['feelings'] = [],
  demo = false,
): TherapySession {
  return {
    id,
    mode: 'exercise',
    started_at: `2026-11-0${id}T12:00:00Z`,
    ended_at: null,
    calibration_id: 1,
    plan: [],
    settings: {} as TherapySession['settings'],
    is_demo: demo,
    summary: null,
    n_attempts: 0,
    attempts: [],
    transcript: [],
    feelings,
  };
}
const feeling = (pain: number, fatigue: number) => ({
  t: '2026-11-07T12:00:00Z',
  session_id: 1,
  attempt_index: 0,
  pain,
  fatigue,
  source: 'ui' as const,
  note: '',
});
function mount(data: TherapySession[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const id = Number(input.split('/').at(-1));
      return new Response(JSON.stringify(data.find((s) => s.id === id)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TherapyReview sessions={data} />
    </QueryClientProvider>,
  );
}
describe('doctor therapy review', () => {
  it('orders by session date, averages reports, preserves missing gaps and demo flags', () => {
    const points = therapyTrend([
      session(3, [feeling(2, 4), feeling(4, 8)], true),
      session(1),
      session(2, [feeling(0, 0)]),
    ]);
    expect(points.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(points.map((p) => [p.pain, p.fatigue])).toEqual([
      [null, null],
      [0, 0],
      [3, 6],
    ]);
    expect(points[2].demo).toBe(true);
  });
  it('loads session details, labels demo reports, and includes rejected and undone decisions', async () => {
    const s = session(1, [feeling(5, 6)], true);
    const therapy = new FakeTherapy();
    therapy.emit('adjust_help', { finger: 'ring' }, 'clamped');
    therapy.emit('add_rest', {}, 'rejected');
    therapy.undo();
    therapy.brake('Pain.', 'local_rule');
    s.coach_decisions = therapy.decisions();
    mount([s, session(2)]);
    expect(
      await screen.findByRole('img', { name: /Reported pain and fatigue/ }),
    ).toBeVisible();
    fireEvent.click(screen.getByText('Show feelings as table'));
    expect(screen.getByRole('table')).toHaveTextContent('5.0');
    expect(screen.getByRole('table')).toHaveTextContent('Demo data');
    expect(screen.getByRole('table')).toHaveTextContent('—');
    expect(
      screen.getByText(
        '4 decisions · 1 brakes · 1 rejected · 4 demo decisions',
      ),
    ).toBeVisible();
    expect(screen.getByText('Rest added · rejected: 1')).toBeVisible();
    expect(screen.getByText('Adjustment undone · undone: 1')).toBeVisible();
  });
  it('handles sessions recorded before the therapist API', async () => {
    const old = session(1);
    delete old.feelings;
    mount([old]);
    expect(await screen.findByText('No feelings recorded yet.')).toBeVisible();
    expect(screen.getByText('No coach decisions recorded yet.')).toBeVisible();
  });
  it('reports unavailable data instead of showing a reassuring empty trend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'offline', message: 'Offline' } }),
            { status: 503 },
          ),
      ),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TherapyReview sessions={[session(1)]} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Records are unavailable/,
    );
    expect(screen.queryByText('No feelings recorded yet.')).toBeNull();
  });
});
