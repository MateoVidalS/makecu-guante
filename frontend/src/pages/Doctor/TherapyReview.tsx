import { useQueries } from '@tanstack/react-query';
import type { Session } from '../../contracts/api';
import { getSession } from '../../api/client';
import { DataSection, DataStatus, formatDate } from '../../components/charts';
import {
  decisionLabel,
  type TherapySession,
} from '../../components/therapy/data';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function therapyTrend(sessions: TherapySession[]) {
  return [...sessions]
    .sort(
      (a, b) =>
        Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id,
    )
    .map((s) => {
      const feelings = s.feelings ?? [];
      const mean = (key: 'pain' | 'fatigue') =>
        feelings.length
          ? feelings.reduce((sum, feeling) => sum + feeling[key], 0) /
            feelings.length
          : null;
      return {
        id: s.id,
        t: Date.parse(s.started_at),
        pain: mean('pain'),
        fatigue: mean('fatigue'),
        demo: s.is_demo,
        count: feelings.length,
      };
    });
}

export function TherapyReview({ sessions }: { sessions: Session[] }) {
  // Reuse replay's cache; no new backend endpoint or shared-contract edit needed.
  const queries = useQueries({
    queries: sessions.map((session) => ({
      queryKey: ['sessions', session.id],
      queryFn: () => getSession(session.id),
    })),
  });
  const data = queries.flatMap((q) =>
    q.data ? [q.data as TherapySession] : [],
  );
  const trend = therapyTrend(data);
  const decisions = data.flatMap((s) =>
    (s.coach_decisions ?? []).map((d) => ({ ...d, demo: s.is_demo })),
  );
  const errors = queries.some((q) => q.isError);
  const loading = queries.some((q) => q.isPending);
  const counts = new Map<string, number>();
  decisions.forEach((d) => {
    const key = `${decisionLabel(d)} · ${d.result}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return (
    <DataSection
      className="report-therapy"
      title="Reported feelings and coach decisions"
      demo={sessions.some((s) => s.is_demo)}
      description="Patient reports, 0–10. Session means; gaps mean no check-in. Demo points are hollow."
    >
      <DataStatus
        loading={loading}
        error={errors ? new Error('Could not load all therapy records.') : null}
      >
        {trend.some((p) => p.count > 0) ? (
          <>
            <div
              className="therapy-trend"
              role="img"
              aria-label="Reported pain and fatigue over sessions, from 0 to 10"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(t: number) => formatDate(t)}
                    stroke="var(--muted)"
                  />
                  <YAxis
                    domain={[0, 10]}
                    ticks={[0, 2, 4, 6, 8, 10]}
                    stroke="var(--muted)"
                  />
                  <Tooltip
                    labelFormatter={(value) => formatDate(Number(value))}
                    formatter={(value, name) => [
                      typeof value === 'number'
                        ? `${value.toFixed(1)}/10`
                        : 'Not recorded',
                      name,
                    ]}
                    contentStyle={{
                      background: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                  {(['pain', 'fatigue'] as const).map((key) => (
                    <Line
                      key={key}
                      dataKey={key}
                      name={key === 'pain' ? 'Pain' : 'Fatigue'}
                      stroke={key === 'pain' ? 'var(--accent)' : 'var(--muted)'}
                      strokeDasharray={key === 'fatigue' ? '5 4' : undefined}
                      connectNulls={false}
                      isAnimationActive={false}
                      dot={({ cx, cy, payload }) =>
                        payload[key] == null ||
                        !Number.isFinite(cx) ||
                        !Number.isFinite(cy) ? (
                          <g key={payload.id} />
                        ) : (
                          <circle
                            className="therapy-feeling-dot"
                            key={payload.id}
                            cx={cx}
                            cy={cy}
                            r={4}
                            stroke={
                              key === 'pain' ? 'var(--accent)' : 'var(--muted)'
                            }
                            fill={
                              payload.demo
                                ? 'var(--surface)'
                                : key === 'pain'
                                  ? 'var(--accent)'
                                  : 'var(--muted)'
                            }
                          >
                            <title>{`${key}: ${payload[key].toFixed(1)}/10${payload.demo ? ' · Demo data' : ''}`}</title>
                          </circle>
                        )
                      }
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="footnote">
              Solid: pain · Dashed: fatigue · Hollow: demo data
            </p>
            <details className="therapy-review-table">
              <summary>Show feelings as table</summary>
              <div className="data-table-wrap">
                <table className="data-table">
                  <caption>Session mean patient reports (0–10)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Pain</th>
                      <th scope="col">Fatigue</th>
                      <th scope="col">Check-ins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">
                          {formatDate(p.t)} · #{p.id}
                          {p.demo ? ' · Demo data' : ''}
                        </th>
                        <td>{p.pain?.toFixed(1) ?? '—'}</td>
                        <td>{p.fatigue?.toFixed(1) ?? '—'}</td>
                        <td>{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="footnote">No feelings recorded yet.</p>
        )}
        <h3 className="therapy-summary-title">Coach decisions summary</h3>
        {decisions.length ? (
          <>
            <p className="footnote">
              {decisions.length} decisions ·{' '}
              {
                decisions.filter(
                  (d) => d.tool === 'brake' && d.result !== 'rejected',
                ).length
              }{' '}
              brakes · {decisions.filter((d) => d.result === 'rejected').length}{' '}
              rejected · {decisions.filter((d) => d.demo).length} demo decisions
            </p>
            <ul className="therapy-summary">
              {[...counts].map(([label, count]) => (
                <li key={label}>
                  {label}: {count}
                </li>
              ))}
            </ul>
            <p className="footnote">
              Open a session replay for reasons, sources, and applied values.
            </p>
          </>
        ) : (
          <p className="footnote">No coach decisions recorded yet.</p>
        )}
      </DataStatus>
    </DataSection>
  );
}
