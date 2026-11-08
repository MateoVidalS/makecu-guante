import { http, HttpResponse } from 'msw';
import { createDemoState } from './demo';
import { GLOVE_FINGERS } from '../contracts/glove';
import type { Profile } from '../contracts/api';
import type { CoachDecision, FeelingEntry } from '../contracts/therapist';
import type {
  Session,
  CalibrationIn,
  SessionIn,
  Evaluation,
  EvaluationIn,
  SummaryIn,
  TranscriptLine,
} from '../contracts/api';
import type { Calibration } from '../contracts/calibration';
import type { AttemptResult, SessionSummary } from '../contracts/engine';

const now = () => new Date().toISOString();
export const createMockState = createDemoState;
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
const orderedSessions = () =>
  [...mockState.sessions].sort((a, b) =>
    a.started_at.localeCompare(b.started_at),
  );
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Same grouping and scored/null rules as backend/app/db/repo.py. */
export function historyRom(
  finger: string | null = null,
  pose: string | null = null,
) {
  return orderedSessions().flatMap((s) =>
    GLOVE_FINGERS.flatMap((f) => {
      if (finger && f !== finger) return [];
      const values = (mockState.details[s.id]?.attempts ?? [])
        .filter((a) => !pose || a.pose === pose)
        .flatMap((a) =>
          a.fingers
            .filter((m) => m.finger === f && m.scored && m.active_max !== null)
            .map((m) => m.active_max!),
        );
      return values.length
        ? [
            {
              session_id: s.id,
              started_at: s.started_at,
              finger: f,
              pose,
              active_max_mean: mean(values),
              is_demo: s.is_demo,
            },
          ]
        : [];
    }),
  );
}
export function historyAssist() {
  return orderedSessions().flatMap((s) =>
    GLOVE_FINGERS.flatMap((f) => {
      const values = (mockState.details[s.id]?.attempts ?? []).flatMap((a) =>
        a.fingers
          .filter((m) => m.finger === f && m.scored && m.assist_needed !== null)
          .map((m) => ({
            need: m.assist_needed!,
            helped: a.assisted && m.assist_needed! > 0 ? 1 : 0,
          })),
      );
      return values.length
        ? [
            {
              session_id: s.id,
              started_at: s.started_at,
              finger: f,
              assist_needed_mean: mean(values.map((m) => m.need)),
              assisted_rate: mean(values.map((m) => m.helped)),
              is_demo: s.is_demo,
            },
          ]
        : [];
    }),
  );
}

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
    mockState.details[s.id] = {
      ...s,
      attempts: [],
      transcript: [],
      coach_decisions: [],
      feelings: [],
    };
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
  http.post(
    '/api/sessions/:id/coach_decisions',
    async ({ params, request }) => {
      const detail = mockState.details[Number(params.id)];
      if (!detail) return missing();
      const { decisions } = (await request.json()) as {
        decisions: CoachDecision[];
      };
      detail.coach_decisions.push(
        ...decisions.map((d) => ({ ...d, session_id: detail.id })),
      );
      return new HttpResponse(null, { status: 204 });
    },
  ),
  http.post('/api/sessions/:id/feelings', async ({ params, request }) => {
    const detail = mockState.details[Number(params.id)];
    if (!detail) return missing();
    const { feelings } = (await request.json()) as { feelings: FeelingEntry[] };
    detail.feelings.push(
      ...feelings.map((f) => ({ ...f, session_id: detail.id })),
    );
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
    const rom = historyRom(),
      assist = historyAssist();
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    return HttpResponse.json({
      sessions: sorted.length,
      attempts: sorted.reduce((n, s) => n + s.n_attempts, 0),
      evaluations: mockState.evaluations.length,
      days_practiced_last_7: new Set(
        sorted
          .filter(
            (s) =>
              s.started_at.slice(0, 10) >= cutoff &&
              s.started_at.slice(0, 10) <= today,
          )
          .map((s) => s.started_at.slice(0, 10)),
      ).size,
      last_session_at: sorted.at(-1)?.started_at ?? null,
      per_finger: GLOVE_FINGERS.map((finger) => ({
        finger,
        active_max_first:
          rom.find((p) => p.finger === finger)?.active_max_mean ?? null,
        active_max_last:
          rom.filter((p) => p.finger === finger).at(-1)?.active_max_mean ??
          null,
        assist_needed_last:
          assist.filter((p) => p.finger === finger).at(-1)
            ?.assist_needed_mean ?? null,
      })),
    });
  }),
  http.get('/api/history/rom', ({ request }) => {
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(historyRom(q.get('finger'), q.get('pose')));
  }),
  http.get('/api/history/assist', () => HttpResponse.json(historyAssist())),
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
    return unavailable('llm_unavailable');
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
          coach_decisions: Object.values(mockState.details).flatMap(
            (s) => s.coach_decisions,
          ),
          feelings: Object.values(mockState.details).flatMap((s) => s.feelings),
        });
    return new HttpResponse(payload, {
      headers: {
        'Content-Type': csv ? 'text/csv' : 'application/json',
        'Content-Disposition': `attachment; filename="rehab.${csv ? 'csv' : 'json'}"`,
      },
    });
  }),
];
