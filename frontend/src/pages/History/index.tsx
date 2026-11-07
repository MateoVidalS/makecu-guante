import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getSession } from '../../api/client';
import type { Session } from '../../contracts/api';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useEvaluations,
  useHistoryAssist,
  useHistoryOverview,
  useHistoryResistance,
  useHistoryRom,
} from '../../api/client';
import { POSES, type PoseId } from '../../contracts/poses';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  AssistTrend,
  DataStatus,
  DemoBadge,
  KpiTile,
  ResistanceSlowFast,
  TrendSmallMultiples,
  fingerName,
  formatDate,
  percentage,
} from '../../components/charts';
import { useAllSessions } from './data';
import { ExportButtons } from '../Doctor/ExportButtons';

const tabs = [
  'Overview',
  'Active range',
  'Assistance',
  'Resistance',
  'Sessions',
];
export default function History() {
  const [params, setParams] = useSearchParams();
  const selected =
    tabs.find((t) => t.toLowerCase() === params.get('tab')) ?? 'Overview';
  const [pose, setPose] = useState<PoseId | ''>('');
  const overview = useHistoryOverview(),
    sessions = useAllSessions(),
    evaluations = useEvaluations();
  const rom = useHistoryRom(pose ? { pose } : {}),
    assist = useHistoryAssist(),
    resistance = useHistoryResistance();
  const timeline = sessions.data?.map((s) => ({ ...s, id: s.id }));
  const evalTimeline = evaluations.data;
  const demo =
    sessions.data?.some((s) => s.is_demo) ||
    evaluations.data?.some((e) => e.is_demo);
  return (
    <section className="data-page">
      <h1>History</h1>
      <p>See what you did on your own.</p>
      <p className="muted">
        Estimated from the camera — not a medical measurement.
      </p>
      {demo && (
        <p>
          <DemoBadge /> Includes sample records. Trends may mix demo and
          recorded data.
        </p>
      )}
      <nav className="data-tabs" aria-label="History views">
        {tabs.map((tab) => (
          <button
            key={tab}
            aria-current={selected === tab ? 'page' : undefined}
            onClick={() => setParams({ tab: tab.toLowerCase() })}
          >
            {tab}
          </button>
        ))}
      </nav>
      {selected === 'Overview' && (
        <DataStatus loading={overview.isPending} error={overview.error}>
          {overview.data && (
            <>
              <div className="kpi-grid">
                <KpiTile label="Sessions" value={overview.data.sessions} />
                <KpiTile label="Attempts" value={overview.data.attempts} />
                <KpiTile
                  label="Days practiced, last 7"
                  value={overview.data.days_practiced_last_7}
                />
                <KpiTile
                  label="Evaluations"
                  value={overview.data.evaluations}
                />
              </div>
              <h2>Your first and latest sessions</h2>
              <p>
                Finger position on your own. Opening and closing poses differ.
              </p>
              <div className="chart-grid">
                {overview.data.per_finger.map((f) => (
                  <KpiTile
                    key={f.finger}
                    label={fingerName(f.finger)}
                    value={`${percentage(f.active_max_first)} → ${percentage(f.active_max_last)}`}
                    hint="First → latest recorded estimate"
                  />
                ))}
              </div>
              {overview.data.sessions === 0 && (
                <p>
                  No sessions yet.{' '}
                  <Link to="/exercise">Start your practice</Link>.
                </p>
              )}
            </>
          )}
        </DataStatus>
      )}
      {selected === 'Active range' && (
        <section className="data-section">
          <h2>How far your fingers moved</h2>
          <label>
            Pose{' '}
            <select
              value={pose}
              onChange={(e) => setPose(e.target.value as PoseId | '')}
            >
              <option value="">All poses</option>
              {Object.values(POSES).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!pose && (
            <p>For a clearer comparison, choose the same pose each time.</p>
          )}
          <DataStatus error={rom.error || sessions.error}>
            <TrendSmallMultiples
              points={rom.data ?? []}
              timeline={timeline}
              loading={rom.isPending || sessions.isPending}
              opening={pose === 'open'}
            />
          </DataStatus>
        </section>
      )}
      {selected === 'Assistance' && (
        <section className="data-section">
          <h2>Help from the glove</h2>
          <DataStatus error={assist.error || sessions.error}>
            <div className="chart-grid">
              {GLOVE_FINGERS.map((finger) => (
                <AssistTrend
                  key={finger}
                  finger={finger}
                  points={assist.data ?? []}
                  timeline={timeline}
                  loading={assist.isPending || sessions.isPending}
                />
              ))}
            </div>
          </DataStatus>
        </section>
      )}
      {selected === 'Resistance' && (
        <section className="data-section">
          <h2>Resistance estimates for your care team</h2>
          <p>These estimates are inspired by clinical practice.</p>
          <DataStatus error={resistance.error || evaluations.error}>
            <div className="chart-grid">
              {GLOVE_FINGERS.map((finger) => (
                <ResistanceSlowFast
                  key={finger}
                  finger={finger}
                  points={resistance.data ?? []}
                  timeline={evalTimeline}
                  loading={resistance.isPending || evaluations.isPending}
                />
              ))}
            </div>
          </DataStatus>
          <EvaluationList />
        </section>
      )}
      {selected === 'Sessions' && (
        <section className="data-section">
          <h2>Your sessions</h2>
          <DataStatus loading={sessions.isPending} error={sessions.error}>
            {!sessions.data?.length ? (
              <p>No sessions recorded yet.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <caption>Choose a date to replay a session.</caption>
                  <thead>
                    <tr>
                      {[
                        'Date (UTC)',
                        'Plan',
                        'Attempts',
                        'On your own',
                        'With help',
                        'Safety events',
                        'Source',
                      ].map((s) => (
                        <th key={s} scope="col">
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <SessionRows sessions={sessions.data} />
                </table>
              </div>
            )}
          </DataStatus>
          <ExportButtons />
        </section>
      )}
    </section>
  );
}
export function EvaluationList() {
  const evaluations = useEvaluations();
  return (
    <DataStatus loading={evaluations.isPending} error={evaluations.error}>
      <div>
        <h3>Saved evaluations</h3>
        {!evaluations.data?.length ? (
          <p>No evaluations recorded yet.</p>
        ) : (
          <ul>
            {evaluations.data.map((e) => (
              <li key={e.id}>
                <Link to={`/history/evaluations/${e.id}`}>
                  {formatDate(e.started_at)}
                </Link>{' '}
                {e.is_demo && <DemoBadge />}
                {e.fingers.some((f) => f.aborted) &&
                  ' · A sweep stopped safely'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DataStatus>
  );
}

function SessionRows({ sessions }: { sessions: Session[] }) {
  const details = useQueries({
    queries: sessions.map((s) => ({
      queryKey: ['sessions', s.id],
      queryFn: () => getSession(s.id),
    })),
  });
  return (
    <tbody>
      {sessions.map((s, i) => (
        <tr key={s.id}>
          <th scope="row">
            <Link to={`/history/sessions/${s.id}`}>
              {formatDate(s.started_at)}
            </Link>
          </th>
          <td>
            {s.plan.map((p) => `${POSES[p.pose].name} × ${p.reps}`).join(', ')}
          </td>
          <td>{s.n_attempts}</td>
          <td>{percentage(s.summary?.active_ratio_mean)}</td>
          <td>{s.summary?.assisted ?? 'Not recorded'}</td>
          <td>
            {details[i].isPending
              ? 'Loading…'
              : details[i].data
                ? details[i].data.attempts.reduce(
                    (n, a) => n + a.safety_events.length,
                    0,
                  )
                : 'Unavailable'}
          </td>
          <td>{s.is_demo ? <DemoBadge /> : 'Recorded'}</td>
        </tr>
      ))}
    </tbody>
  );
}
