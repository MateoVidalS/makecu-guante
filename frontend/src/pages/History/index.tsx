import { PageHeader, Tabs } from '../../design-system';
import { useQueries } from '@tanstack/react-query';
import { getSession } from '../../api/client';
import type { Session } from '../../contracts/api';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useEvaluations,
  useHistoryAssist,
  useHistoryOverview,
  useHistoryRom,
} from '../../api/client';
import { POSES } from '../../contracts/poses';
import {
  DataSection,
  DataStatus,
  HandRangeMap,
  KpiRow,
  KpiTile,
  LatestEffortBars,
  PracticeCalendar,
  formatDate,
  handFromOverview,
  percentage,
} from '../../components/charts';
import { firstAndLast, useAllSessions } from './data';
import './history.css';

const tabs = ['Overview', 'Sessions'];
export default function History() {
  const [params, setParams] = useSearchParams();
  const selected =
    tabs.find((t) => t.toLowerCase() === params.get('tab')) ?? 'Overview';
  const overview = useHistoryOverview(),
    sessions = useAllSessions();
  const allRom = useHistoryRom(),
    assist = useHistoryAssist();
  const demoSessions = !!sessions.data?.some((s) => s.is_demo);
  return (
    <section className="data-page">
      <PageHeader
        title="History"
        lead="What you did on your own over time, estimated from the camera."
      />
      <Tabs
        label="History views"
        value={selected}
        onChange={(tab) => setParams({ tab: tab.toLowerCase() })}
        items={tabs.map((tab) => ({ id: tab, label: tab }))}
      />
      {selected === 'Overview' && (
        <DataStatus loading={overview.isPending} error={overview.error}>
          {overview.data && (
            <>
              <KpiRow>
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
              </KpiRow>
              <DataSection
                title="First and latest sessions"
                description="How far each glove finger closed on its own: your first session next to the latest."
                demo={demoSessions}
                demoNote="Demo data is drawn hollow"
              >
                {overview.data.sessions === 0 ? (
                  <p className="footnote">
                    No sessions yet.{' '}
                    <Link to="/exercise">Start your practice</Link>.
                  </p>
                ) : (
                  <>
                    <HandRangeMap
                      loading={sessions.isPending}
                      {...handFromOverview(overview.data, sessions.data)}
                      {...firstAndLast(sessions.data)}
                    />
                    <div className="viz-grid-2">
                      <LatestEffortBars
                        timeline={sessions.data}
                        rom={allRom.data ?? []}
                        assist={assist.data ?? []}
                        loading={
                          allRom.isPending ||
                          assist.isPending ||
                          sessions.isPending
                        }
                      />
                      <PracticeCalendar
                        sessions={sessions.data ?? []}
                        loading={sessions.isPending}
                      />
                    </div>
                  </>
                )}
              </DataSection>
            </>
          )}
        </DataStatus>
      )}
      {selected === 'Sessions' && <SessionList />}
    </section>
  );
}
export function SessionList({ doctor = false }: { doctor?: boolean }) {
  const sessions = useAllSessions();
  return (
    <DataSection
      title={doctor ? 'Saved sessions' : 'Your sessions'}
      description="Choose a date to replay a session."
    >
      <DataStatus loading={sessions.isPending} error={sessions.error}>
        {!sessions.data?.length ? (
          <p className="footnote">No sessions recorded yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <caption className="sr-only">
                Choose a date to replay a session.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">Plan</th>
                  <th scope="col" className="num">
                    Attempts
                  </th>
                  <th scope="col" className="num">
                    On your own
                  </th>
                  <th scope="col" className="num">
                    With help
                  </th>
                  <th scope="col" className="num">
                    Safety events
                  </th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <SessionRows sessions={sessions.data} />
            </table>
          </div>
        )}
      </DataStatus>
    </DataSection>
  );
}

export function EvaluationList() {
  const evaluations = useEvaluations();
  return (
    <DataSection title="Saved evaluations" className="saved-evaluations">
      <DataStatus loading={evaluations.isPending} error={evaluations.error}>
        {!evaluations.data?.length ? (
          <p className="footnote">No evaluations recorded yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">Sweeps</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.data.map((e) => (
                  <tr key={e.id}>
                    <th scope="row">
                      <Link to={`/history/evaluations/${e.id}`}>
                        {formatDate(e.started_at)}
                      </Link>
                    </th>
                    <td>
                      {e.fingers.some((f) => f.aborted)
                        ? 'A sweep stopped safely'
                        : 'Complete'}
                    </td>
                    <td className="muted">
                      {e.is_demo ? 'Demo data' : 'Recorded'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataStatus>
    </DataSection>
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
          <td className="num">{s.n_attempts}</td>
          <td className="num">{percentage(s.summary?.active_ratio_mean)}</td>
          <td className="num">{s.summary?.assisted ?? '—'}</td>
          <td className="num">
            {details[i].isPending
              ? 'Loading…'
              : details[i].data
                ? details[i].data.attempts.reduce(
                    (n, a) => n + a.safety_events.length,
                    0,
                  )
                : '—'}
          </td>
          <td className="muted">{s.is_demo ? 'Demo data' : 'Recorded'}</td>
        </tr>
      ))}
    </tbody>
  );
}
