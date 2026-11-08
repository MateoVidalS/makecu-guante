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
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { server } from '../../mocks/server';
import { resetMocks } from '../../mocks/handlers';
import { addAttempt, createSession, endSession } from '../../api/client';
import type { Attempt, Session } from '../../contracts/api';
import type {
  AttemptResult,
  FingerAttemptMetrics,
  SessionSummary,
} from '../../contracts/engine';
import { GLOVE_FINGERS, type GloveFinger } from '../../contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { summarizeSession } from '../../engine/metrics';
import { SessionRecap, SessionRecapView } from './SessionRecap';
import {
  findPreviousSession,
  openingByFinger,
  type RecapComparison,
} from './recapData';

const emptyTrace = (): AttemptResult['trace'] => ({
  hz: 20,
  t: [],
  closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
  servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
  ma: [],
  phase: [],
});
/** Closures per glove finger: best on your own, and at the end of the hold. */
function fingers(
  target: number,
  best: Partial<Record<GloveFinger, number>>,
  final: Partial<Record<GloveFinger, number>> = best,
): FingerAttemptMetrics[] {
  return GLOVE_FINGERS.map((finger) => ({
    finger,
    scored: best[finger] != null,
    target: best[finger] != null ? target : null,
    active_max: best[finger] ?? null,
    assist_needed:
      best[finger] != null ? Math.max(0, best[finger]! - target) : null,
    final: final[finger] ?? null,
  }));
}
const all = (v: number) =>
  Object.fromEntries(GLOVE_FINGERS.map((f) => [f, v])) as Record<
    GloveFinger,
    number
  >;
function attempt(over: Partial<AttemptResult> = {}): AttemptResult {
  return {
    pose: 'open',
    rep: 1,
    index: 0,
    started_at: '2026-11-08T10:00:00Z',
    ended_at: '2026-11-08T10:00:10Z',
    reached_active: false,
    reached_final: false,
    assisted: false,
    time_to_position_s: null,
    active_ratio: 0.5,
    fingers: fingers(0, all(0.5)),
    pinch_min: null,
    current_peak_ma: null,
    current_mean_ma: null,
    safety_events: [],
    interrupted: false,
    trace: emptyTrace(),
    ...over,
  };
}
const saved = (a: AttemptResult, id: number, session_id = 1): Attempt => {
  const { trace: _trace, ...rest } = a;
  return { ...rest, id, session_id };
};

// QA case A: the first three poses of "Opening practice" paused, then the session ended.
const caseA = [
  attempt({
    pose: 'full_fist',
    index: 0,
    interrupted: true,
    fingers: fingers(0.95, all(0.9)),
  }),
  attempt({
    pose: 'thumbs_up',
    index: 1,
    interrupted: true,
    fingers: fingers(0, { thumb: 0.54 }),
  }),
  attempt({
    pose: 'peace',
    index: 2,
    interrupted: true,
    fingers: fingers(0, { index: 0.53, middle: 0.53 }),
  }),
];
// QA case B: rigid index. The glove opened the others, met resistance at the index and eased off.
const caseB = attempt({
  assisted: true,
  reached_final: false,
  fingers: fingers(
    0,
    { ...all(0.52), index: 0.58 },
    { ...all(0.1), index: 0.6 },
  ),
  safety_events: [
    { source: 'resistance', t_rel: 6.95, finger: 'index', ma: 1037 },
  ],
});

afterEach(cleanup);

describe('recap data', () => {
  it('credits the glove with the opening it measurably added, never the remaining gap', () => {
    const [thumb, index] = openingByFinger([caseB]);
    expect(thumb.active_max_mean).toBeCloseTo(0.48);
    expect(thumb.glove_added_mean).toBeCloseTo(0.42);
    // The index stayed where it was: the glove added nothing (its deficit was 0.58).
    expect(index.active_max_mean).toBeCloseTo(0.42);
    expect(index.glove_added_mean).toBe(0);
  });
  it('gives the glove no credit for interrupted or unassisted attempts', () => {
    const opening = openingByFinger(caseA);
    expect(opening.every((f) => f.glove_added_mean == null)).toBe(true);
    expect(
      opening.find((f) => f.finger === 'thumb')!.active_max_mean,
    ).toBeCloseTo(0.46);
    // Fists do not count as opening.
    expect(
      opening.find((f) => f.finger === 'ring')!.active_max_mean,
    ).toBeNull();
    expect(
      openingByFinger([{ ...caseB, interrupted: true }])[0].glove_added_mean,
    ).toBeNull();
  });
  it('finds the session behind summary.previous: same numbers, direction and earlier', () => {
    const summary = summarizeSession([caseB]);
    const session = (over: Partial<Session>): Session => ({
      id: 1,
      mode: 'exercise',
      started_at: '2026-11-06T10:00:00Z',
      ended_at: null,
      calibration_id: 1,
      plan: [],
      settings: DEFAULT_EXERCISE_SETTINGS,
      is_demo: false,
      summary,
      n_attempts: 1,
      assist_direction: 'open',
      ...over,
    });
    const previous = {
      active_ratio_mean: summary.active_ratio_mean,
      per_finger: summary.per_finger.map(({ finger, active_max_mean }) => ({
        finger,
        active_max_mean,
      })),
    };
    const current = session({
      id: 9,
      started_at: '2026-11-08T10:00:00Z',
    });
    const list = [
      current,
      session({ id: 5, is_demo: true, started_at: '2026-11-07T10:00:00Z' }),
      session({ id: 4 }),
      session({ id: 3, assist_direction: 'close' }),
      session({ id: 2, started_at: '2026-11-09T10:00:00Z' }),
      session({ id: 6, summary: { ...summary, active_ratio_mean: 0.1 } }),
    ];
    // Real data wins over a newer demo session, as in the backend.
    expect(findPreviousSession(list, current, previous)?.id).toBe(4);
    expect(
      findPreviousSession(
        list.filter((s) => s.id !== 4),
        current,
        previous,
      )?.id,
    ).toBe(5);
    expect(
      findPreviousSession(list, current, {
        ...previous,
        active_ratio_mean: 0.99,
      }),
    ).toBeNull();
  });
});

function summaryWith(
  list: AttemptResult[],
  previous: SessionSummary['previous'],
): SessionSummary {
  return { ...summarizeSession(list), previous };
}
function comparison(
  list: AttemptResult[],
  previous: SessionSummary['previous'],
  then: RecapComparison['then'] = null,
): RecapComparison {
  return {
    summary: summaryWith(list, previous),
    attempts: list.map((a, i) => saved(a, i + 1)),
    then,
  };
}

describe('session recap labels', () => {
  it('case A: interrupted attempts are "ended early" and the glove gets no credit', () => {
    render(
      <SessionRecapView
        summary={summarizeSession(caseA)}
        attempts={caseA}
        comparison={null}
      />,
    );
    expect(
      screen.getByText(
        '3 attempts · 0 on your own · 0 with help · 3 ended early',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('Short session today. Rest, then try again later.'),
    ).toBeVisible();
    expect(screen.queryByText(/glove helped/i)).toBeNull();
    expect(screen.queryByText('Glove added')).toBeNull();
    expect(document.querySelector('.mx-split .mx-fill--help')).toBeNull();
    expect(screen.getByText('Attempt 1: Ended early')).toBeTruthy();
    expect(screen.getByText('Attempt 3: Ended early')).toBeTruthy();
  });
  it('case B: a resistance stop is a calm "part way", not "reached with the glove"', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([caseB])}
        attempts={[caseB]}
        comparison={null}
      />,
    );
    expect(screen.queryByText(/Reached with the glove/)).toBeNull();
    expect(
      screen.getByText(
        'Attempt 1: Part way with the glove. It eased off when it felt resistance',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Good effort today. The glove eased off when it felt resistance.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Index: 42% on your own' }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Thumb: 48% on your own, the glove added 42%',
      }),
    ).toBeVisible();
  });
  it('says "reached with the glove" when the glove did complete the pose', () => {
    const done = { ...caseB, reached_final: true, safety_events: [] };
    render(
      <SessionRecapView
        summary={summarizeSession([done])}
        attempts={[done]}
        comparison={null}
      />,
    );
    expect(screen.getByText('Attempt 1: Reached with the glove')).toBeTruthy();
    expect(
      screen.getByText('Good effort today. The glove helped where needed.'),
    ).toBeVisible();
  });
});

describe('session recap comparison (summary.previous)', () => {
  const today = attempt({ fingers: fingers(0, all(0.4)) }); // 60% open
  const before = attempt({ fingers: fingers(0, { ...all(0.5), pinky: 0.3 }) });
  const thenSession = (is_demo: boolean): Session => ({
    id: 41,
    mode: 'exercise',
    started_at: '2026-11-06T10:00:00Z',
    ended_at: '2026-11-06T10:10:00Z',
    calibration_id: 1,
    plan: [],
    settings: DEFAULT_EXERCISE_SETTINGS,
    is_demo,
    summary: summarizeSession([before]),
    n_attempts: 1,
    assist_direction: 'open',
  });
  // As stored: all-pose closure means (here the thumb's fists pull it to 0.9). Never compared directly.
  const previous = {
    active_ratio_mean: 0.45,
    per_finger: [{ finger: 'thumb' as const, active_max_mean: 0.9 }],
  };
  const lastTime = /^Last time/;

  it('waits quietly while loading: no starting-point claim, no deltas', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([today])}
        attempts={[today]}
        comparison={null}
      />,
    );
    expect(screen.queryByText(/starting point/)).toBeNull();
    expect(screen.queryByRole('img', { name: lastTime })).toBeNull();
    expect(screen.getAllByRole('img', { name: /^Today:/ })).toHaveLength(1);
  });
  it('keeps the starting-point copy only when there is no previous session', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([today])}
        attempts={[today]}
        comparison={comparison([today], null)}
      />,
    );
    expect(
      screen.getByText(
        'This is your starting point. Next time you will see the change.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('img', { name: lastTime })).toBeNull();
  });
  it('compares each finger with the same opening measure from the previous session', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([today])}
        attempts={[today]}
        comparison={comparison([today], previous, {
          session: thenSession(false),
          attempts: [saved(before, 7, 41)],
        })}
      />,
    );
    expect(screen.queryByText(/starting point/)).toBeNull();
    expect(
      screen.getByRole('img', { name: /^Last time: Thumb 50%/ }),
    ).toBeVisible();
    // 60% today vs 50% then (pinky 70% then).
    const list = document.querySelector('.mx-thennow__list') as HTMLElement;
    expect(
      within(list).getAllByText('(better)', { exact: false }),
    ).toHaveLength(4);
    expect(within(list).getAllByText('(lower)', { exact: false })).toHaveLength(
      1,
    );
    expect(within(list).getAllByText('+10')).toHaveLength(4);
    // No mixed all-pose number (fists included) next to the openings.
    expect(screen.queryByText(/of the goal/)).toBeNull();
  });
  it('labels a demo session used as "last time"', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([today])}
        attempts={[today]}
        comparison={comparison([today], previous, {
          session: thenSession(true),
          attempts: [saved(before, 7, 41)],
        })}
      />,
    );
    expect(screen.getByText('Last time (demo data)')).toBeVisible();
  });
  it('shows a gap, not a mixed comparison, when the earlier attempts cannot be read', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([today])}
        attempts={[today]}
        comparison={comparison([today], previous)}
      />,
    );
    expect(screen.queryByText(/starting point/)).toBeNull();
    expect(screen.queryByRole('img', { name: lastTime })).toBeNull();
    expect(document.querySelector('.mx-delta')).toBeNull();
  });
  it('uses the saved attempts when the live list is gone', () => {
    render(
      <SessionRecapView
        summary={summarizeSession([caseB])}
        attempts={[]}
        comparison={comparison([caseB], null)}
      />,
    );
    expect(
      screen.getByText(
        'Attempt 1: Part way with the glove. It eased off when it felt resistance',
      ),
    ).toBeTruthy();
  });
});

describe('session recap with the mock API', () => {
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
    resetMocks();
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
    vi.stubGlobal('fetch', nativeFetch);
  });

  async function savedSession(list: AttemptResult[]) {
    const session = await createSession({
      mode: 'exercise',
      plan: [{ pose: 'open', reps: list.length }],
      settings: DEFAULT_EXERCISE_SETTINGS,
      calibration_id: 1, // the demo story's opening-glove calibration
    });
    for (const result of list) await addAttempt({ id: session.id, result });
    await endSession({ id: session.id, summary: summarizeSession(list) });
    return session.id;
  }
  function mount(id: number, list: AttemptResult[]) {
    const runtime = new ScriptedRuntime({ persist: false });
    runtime.exerciseStore.setState({ sessionId: id });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <RuntimeProvider runtime={runtime}>
          <SessionRecap summary={summarizeSession(list)} attempts={list} />
        </RuntimeProvider>
      </QueryClientProvider>,
    );
  }

  it('fetches the saved session and compares with summary.previous', async () => {
    const id = await savedSession([caseB]);
    mount(id, [caseB]);
    // Renders at once from the live results...
    expect(
      screen.getByRole('heading', { name: 'Session complete' }),
    ).toBeVisible();
    // ...then the stored previous (the demo story's last opening session) adds the deltas.
    expect(
      await screen.findByRole('img', { name: /^Last time \(demo data\):/ }),
    ).toBeVisible();
    expect(document.querySelector('.mx-delta')).not.toBeNull();
    expect(screen.queryByText(/starting point/)).toBeNull();
  });
  it('compares a second real session with the first, not with demo data', async () => {
    const first = await savedSession([caseB]);
    const better = attempt({ fingers: fingers(0, all(0.3)) });
    const id = await savedSession([better]);
    expect(id).toBeGreaterThan(first);
    mount(id, [better]);
    expect(
      await screen.findByRole('img', { name: /^Last time: Thumb 48%/ }),
    ).toBeVisible();
    expect(screen.queryByText(/demo data/)).toBeNull();
  });
  it('keeps the recap as it is when the saved session cannot be read', async () => {
    const id = await savedSession([caseB]);
    const { http, HttpResponse } = await import('msw');
    let calls = 0;
    server.use(
      http.get('*/api/sessions/:id', () => {
        calls += 1;
        return HttpResponse.json(
          { error: { code: 'internal', message: 'down' } },
          { status: 500 },
        );
      }),
    );
    mount(id, [caseB]);
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1); // no retry storm on a real error
    expect(
      screen.getByRole('heading', { name: 'Session complete' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Good effort today. The glove eased off when it felt resistance.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/starting point/)).toBeNull();
    expect(screen.queryByRole('img', { name: /^Last time/ })).toBeNull();
  });
});
