import { PageHeader, Tabs, Select } from '../../design-system';
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
import {
  DataSection,
  DataStatus,
  EffortSmallMultiples,
  HandRangeMap,
  KpiRow,
  KpiTile,
  LatestEffortBars,
  PracticeCalendar,
  ResistanceDumbbells,
  TrendSmallMultiples,
  formatDate,
  handFromOverview,
  percentage,
} from '../../components/charts';
import { firstAndLast, useAllSessions } from './data';
import { ExportButtons } from '../Doctor/ExportButtons';
import './history.css';

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
    allRom = useHistoryRom(),
    assist = useHistoryAssist(),
    resistance = useHistoryResistance();
  const timeline = sessions.data?.map((s) => ({ ...s, id: s.id }));
  const demoSessions = !!sessions.data?.some((s) => s.is_demo);
  const demoEvaluations = !!evaluations.data?.some((e) => e.is_demo);
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
      {selected === 'Active range' && (
        <DataSection
          title="How far your fingers moved"
          description={
            pose
              ? 'Best finger position on your own, per session.'
              : 'Best finger position on your own, per session. Choose one pose for a clearer comparison.'
          }
          demo={demoSessions}
          actions={
            <div className="history-pose">
              <Select
                label="Pose"
                layout="inline"
                value={pose}
                onChange={(e) => setPose(e.target.value as PoseId | '')}
              >
                <option value="">All poses</option>
                {Object.values(POSES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          }
        >
          <DataStatus error={rom.error || sessions.error}>
            <TrendSmallMultiples
              points={rom.data ?? []}
              timeline={timeline}
              loading={rom.isPending || sessions.isPending}
              opening={pose === 'open'}
            />
          </DataStatus>
        </DataSection>
      )}
      {selected === 'Assistance' && (
        <DataSection
          title="On your own vs. help from the glove"
          description="Each session split into what the finger closed on its own (blue) and what the glove added to reach the target (orange). All poses."
          demo={demoSessions}
          demoNote="Demo data is drawn hollow"
        >
          <DataStatus error={assist.error || allRom.error}>
            <EffortSmallMultiples
              timeline={sessions.data}
              rom={allRom.data ?? []}
              assist={assist.data ?? []}
              loading={
                assist.isPending || allRom.isPending || sessions.isPending
              }
            />
          </DataStatus>
        </DataSection>
      )}
      {selected === 'Resistance' && (
        <>
          <DataSection
            title="Resistance estimates for your care team"
            description="Extra motor current at slow and fast speeds. An estimate inspired by clinical practice."
            demo={demoEvaluations}
            demoNote="Demo data is drawn hollow"
          >
            <DataStatus error={resistance.error || evaluations.error}>
              <ResistanceDumbbells
                points={resistance.data ?? []}
                loading={resistance.isPending || evaluations.isPending}
              />
            </DataStatus>
          </DataSection>
          <EvaluationList />
        </>
      )}
      {selected === 'Sessions' && (
        <DataSection
          title="Your sessions"
          description="Choose a date to replay a session."
          actions={<ExportButtons size="sm" />}
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
      )}
    </section>
  );
}
export function EvaluationList() {
  const evaluations = useEvaluations();
  return (
    <DataSection title="Saved evaluations">
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
