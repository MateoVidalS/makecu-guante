import { http, HttpResponse } from 'msw';
import * as fixtures from '../contracts/fixtures.check';
import type {
  Profile,
  Session,
  SessionDetail,
  CalibrationIn,
  SessionIn,
  Evaluation,
  EvaluationIn,
  SummaryIn,
  Summary,
  TranscriptLine,
} from '../contracts/api';
import type { Calibration } from '../contracts/calibration';
import type {
  AttemptResult,
  AttemptTrace,
  SessionSummary,
} from '../contracts/engine';

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
export function createMockState() {
  return {
    profile: clone(fixtures.profile) as Profile,
    calibrations: [clone(fixtures.calibration)] as Calibration[],
    sessions: clone(fixtures.sessions) as Session[],
    details: Object.fromEntries(
      fixtures.sessions.map((s) => {
        const attempt = clone(fixtures.session_detail.attempts[0]);
        attempt.id = s.id === 8 ? 1 : s.id + 1;
        attempt.session_id = s.id;
        attempt.started_at = s.started_at;
        attempt.ended_at = s.ended_at!;
        attempt.active_ratio = s.summary!.active_ratio_mean;
        for (const f of attempt.fingers) {
          const metric = s.summary!.per_finger.find(
            (m) => m.finger === f.finger,
          );
          if (metric) {
            f.active_max = metric.active_max_mean;
            f.assist_needed = metric.assist_needed_mean;
          }
        }
        return [
          s.id,
          {
            ...clone(s),
            attempts: [attempt],
            transcript:
              s.id === 8 ? clone(fixtures.session_detail.transcript) : [],
          },
        ];
      }),
    ) as Record<number, SessionDetail>,
    traces: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        i + 1,
        clone(fixtures.attempt_trace),
      ]),
    ) as Record<number, AttemptTrace>,
    evaluations: clone(fixtures.evaluations) as Evaluation[],
    summaries: clone(fixtures.summaries) as Summary[],
  };
}
export let mockState = createMockState();
export const resetMocks = () => {
  mockState = createMockState();
};
const missing = () =>
  HttpResponse.json(
    { error: { code: 'not_found', message: 'Record not found' } },
    { status: 404 },
  );
const unavailable = (code: string) =>
  HttpResponse.json(
    { error: { code, message: 'Unavailable in the foundation mock' } },
    { status: 503 },
  );
const nextId = (items: { id: number }[]) =>
  Math.max(0, ...items.map((x) => x.id)) + 1;
export const handlers = [
  http.get('/api/health', () =>
    HttpResponse.json({ ok: true, version: '0.1.0', gemini: false }),
  ),
  http.get('/api/profile', () => HttpResponse.json(mockState.profile)),
  http.put('/api/profile', async ({ request }) => {
    mockState.profile = (await request.json()) as Profile;
    return HttpResponse.json(mockState.profile);
  }),
  http.get('/api/calibrations/latest', () =>
    HttpResponse.json(mockState.calibrations[0] ?? null),
  ),
  http.get('/api/calibrations', () =>
    HttpResponse.json(mockState.calibrations),
  ),
  http.post('/api/calibrations', async ({ request }) => {
    const c: Calibration = {
      ...((await request.json()) as CalibrationIn),
      id: nextId(mockState.calibrations),
      created_at: now(),
    };
    mockState.calibrations.unshift(c);
    return HttpResponse.json(c);
  }),
  http.get('/api/sessions', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const items = mockState.sessions.filter(
      (s) => !q.get('mode') || s.mode === q.get('mode'),
    );
    const offset = Math.max(0, Number(q.get('offset') ?? 0));
    return HttpResponse.json(
      items.slice(offset, offset + Math.max(0, Number(q.get('limit') ?? 50))),
    );
  }),
  http.post('/api/sessions', async ({ request }) => {
    const value = (await request.json()) as SessionIn;
    const s: Session = {
      ...value,
      is_demo: value.is_demo ?? false,
      id: nextId(mockState.sessions),
      started_at: now(),
      ended_at: null,
      summary: null,
      n_attempts: 0,
    };
    mockState.sessions.unshift(s);
    mockState.details[s.id] = { ...s, attempts: [], transcript: [] };
    return HttpResponse.json(s);
  }),
  http.get('/api/sessions/:id', ({ params }) =>
    mockState.details[Number(params.id)]
      ? HttpResponse.json(mockState.details[Number(params.id)])
      : missing(),
  ),
  http.post('/api/sessions/:id/attempts', async ({ params, request }) => {
    const id = Number(params.id),
      detail = mockState.details[id];
    if (!detail) return missing();
    const { trace, ...result } = (await request.json()) as AttemptResult;
    const attempt = {
      ...result,
      id: Math.max(0, ...Object.keys(mockState.traces).map(Number)) + 1,
      session_id: id,
    };
    detail.attempts.push(attempt);
    mockState.traces[attempt.id] = trace;
    detail.n_attempts++;
    const session = mockState.sessions.find((s) => s.id === id);
    if (session) session.n_attempts = detail.n_attempts;
    return HttpResponse.json(attempt);
  }),
  http.post('/api/sessions/:id/end', async ({ params, request }) => {
    const id = Number(params.id),
      s = mockState.sessions.find((x) => x.id === id);
    if (!s) return missing();
    const { summary } = (await request.json()) as { summary: SessionSummary };
    s.summary = summary;
    s.ended_at = now();
    Object.assign(mockState.details[id], s);
    return HttpResponse.json(s);
  }),
  http.delete('/api/sessions/:id', ({ params }) => {
    const id = Number(params.id);
    if (!mockState.details[id]) return missing();
    mockState.details[id].attempts.forEach(
      (a) => delete mockState.traces[a.id],
    );
    mockState.sessions = mockState.sessions.filter((s) => s.id !== id);
    delete mockState.details[id];
    mockState.summaries = mockState.summaries.filter(
      (s) => s.session_id !== id,
    );
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/attempts/:id/trace', ({ params }) =>
    mockState.traces[Number(params.id)]
      ? HttpResponse.json(mockState.traces[Number(params.id)])
      : missing(),
  ),
  http.post('/api/sessions/:id/transcript', async ({ params, request }) => {
    const detail = mockState.details[Number(params.id)];
    if (!detail) return missing();
    const { lines } = (await request.json()) as { lines: TranscriptLine[] };
    detail.transcript.push(...lines);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/evaluations', () => HttpResponse.json(mockState.evaluations)),
  http.get('/api/evaluations/:id', ({ params }) => {
    const e = mockState.evaluations.find((e) => e.id === Number(params.id));
    return e ? HttpResponse.json(e) : missing();
  }),
  http.post('/api/evaluations', async ({ request }) => {
    const value = (await request.json()) as EvaluationIn;
    const e: Evaluation = {
      ...value,
      id: nextId(mockState.evaluations),
      is_demo: value.is_demo ?? false,
    };
    mockState.evaluations.unshift(e);
    return HttpResponse.json(e);
  }),
  http.get('/api/history/overview', () => {
    const sorted = [...mockState.sessions].sort((a, b) =>
      a.started_at.localeCompare(b.started_at),
    );
    const completed = sorted.filter((s) => s.summary);
    const first = completed[0],
      last = completed.at(-1);
    return HttpResponse.json({
      sessions: sorted.length,
      attempts: sorted.reduce((n, s) => n + s.n_attempts, 0),
      evaluations: mockState.evaluations.length,
      days_practiced_last_7: new Set(
        sorted
          .filter((s) => Date.parse(s.started_at) >= Date.now() - 7 * 86400000)
          .map((s) => s.started_at.slice(0, 10)),
      ).size,
      last_session_at: sorted.at(-1)?.started_at ?? null,
      per_finger: (['thumb', 'index', 'middle'] as const).map((finger) => ({
        finger,
        active_max_first:
          first?.summary?.per_finger.find((f) => f.finger === finger)
            ?.active_max_mean ?? null,
        active_max_last:
          last?.summary?.per_finger.find((f) => f.finger === finger)
            ?.active_max_mean ?? null,
        assist_needed_last:
          last?.summary?.per_finger.find((f) => f.finger === finger)
            ?.assist_needed_mean ?? null,
      })),
    });
  }),
  http.get('/api/history/rom', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const rows = [...mockState.sessions]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .flatMap((s) =>
        (s.summary?.per_finger ?? [])
          .filter(
            (f) =>
              f.active_max_mean !== null &&
              (!q.get('finger') || f.finger === q.get('finger')) &&
              (!q.get('pose') || s.plan.some((p) => p.pose === q.get('pose'))),
          )
          .map((f) => ({
            session_id: s.id,
            started_at: s.started_at,
            finger: f.finger,
            pose: s.plan.length === 1 ? s.plan[0].pose : null,
            active_max_mean: f.active_max_mean,
            is_demo: s.is_demo,
          })),
      );
    return HttpResponse.json(rows);
  }),
  http.get('/api/history/assist', () =>
    HttpResponse.json(
      [...mockState.sessions]
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .flatMap((s) =>
          (s.summary?.per_finger ?? [])
            .filter((f) => f.assist_needed_mean !== null)
            .map((f) => ({
              session_id: s.id,
              started_at: s.started_at,
              finger: f.finger,
              assist_needed_mean: f.assist_needed_mean,
              assisted_rate:
                s.summary!.assisted / Math.max(1, s.summary!.attempts),
              is_demo: s.is_demo,
            })),
        ),
    ),
  ),
  http.get('/api/history/resistance', () =>
    HttpResponse.json(
      [...mockState.evaluations]
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .flatMap((e) =>
          e.fingers.map((f) => ({
            evaluation_id: e.id,
            started_at: e.started_at,
            finger: f.finger,
            slow: f.resistance_slow_ma,
            fast: f.resistance_fast_ma,
            dependence: f.velocity_dependence_ma,
            is_demo: e.is_demo,
          })),
        ),
    ),
  ),
  http.get('/api/summaries', ({ request }) => {
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(
      mockState.summaries
        .filter((s) => !q.get('kind') || s.kind === q.get('kind'))
        .slice(0, Number(q.get('limit') ?? 20)),
    );
  }),
  http.post('/api/summaries', async ({ request }) => {
    const value = (await request.json()) as SummaryIn;
    if (value.kind === 'session' && !mockState.details[value.session_id])
      return missing();
    const s: Summary = {
      id: nextId(mockState.summaries),
      kind: value.kind,
      session_id: value.kind === 'session' ? value.session_id : null,
      days: value.kind === 'therapist' ? value.days : null,
      created_at: now(),
      model: 'fixture',
      text: fixtures.summaries.find((s) => s.kind === value.kind)!.text,
    };
    mockState.summaries.unshift(s);
    return HttpResponse.json(s);
  }),
  http.post('/api/voice/token', () => unavailable('voice_unavailable')),
  http.get('/api/export', ({ request }) => {
    const csv = new URL(request.url).searchParams.get('format') === 'csv';
    const attempts = Object.values(mockState.details).flatMap(
      (s) => s.attempts,
    );
    const payload = csv
      ? [
          'session_id,attempt_id,finger,active_max,is_demo',
          ...attempts.flatMap((a) =>
            a.fingers.map(
              (f) =>
                `${a.session_id},${a.id},${f.finger},${f.active_max ?? ''},${mockState.details[a.session_id].is_demo}`,
            ),
          ),
        ].join('\n')
      : JSON.stringify({
          sessions: mockState.sessions,
          attempts,
          evaluations: mockState.evaluations,
        });
    return new HttpResponse(payload, {
      headers: {
        'Content-Type': csv ? 'text/csv' : 'application/json',
        'Content-Disposition': `attachment; filename="rehab.${csv ? 'csv' : 'json'}"`,
      },
    });
  }),
];
