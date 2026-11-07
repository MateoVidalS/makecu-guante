import {
  useProfile,
  useHistoryOverview,
  useHistoryRom,
  useHistoryAssist,
  useHistoryResistance,
  useEvaluations,
  useSummaries,
  useCreateSummary,
} from '../../api/client';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  AssistTrend,
  DataStatus,
  DemoBadge,
  KpiTile,
  ResistanceSlowFast,
  TrendSmallMultiples,
  formatDate,
} from '../../components/charts';
import { useAllSessions } from '../History/data';
import { ExportButtons } from './ExportButtons';
import './doctor.css';

export default function Doctor() {
  const profile = useProfile(),
    overview = useHistoryOverview(),
    sessions = useAllSessions(),
    evaluations = useEvaluations();
  const rom = useHistoryRom(),
    assist = useHistoryAssist(),
    resistance = useHistoryResistance();
  const summaries = useSummaries({ kind: 'therapist', limit: 20 }),
    generate = useCreateSummary();
  const latest = summaries.data
    ?.slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const hasDemo =
    sessions.data?.some((s) => s.is_demo) ||
    evaluations.data?.some((e) => e.is_demo);
  return (
    <section className="data-page doctor-report">
      <section className="report-page data-section">
        <h1>Doctor view</h1>
        <p className="report-label">
          Rehab Hub · read-only clinical review · {formatDate(Date.now())}
        </p>
        <p>
          Estimates inspired by clinical practice; not validated medical
          measurements.
        </p>
        {hasDemo && (
          <p>
            <DemoBadge /> This report includes sample records. Demo and recorded
            data may appear together.
          </p>
        )}
        <DataStatus loading={profile.isPending} error={profile.error}>
          {profile.data && (
            <section className="card">
              <h2>{profile.data.pseudonym || 'Patient profile'}</h2>
              <dl className="profile-details">
                <dt>Affected hand</dt>
                <dd>{profile.data.affected_hand}</dd>
                <dt>Condition</dt>
                <dd>{profile.data.condition || 'Not provided'}</dd>
                <dt>Goals</dt>
                <dd>{profile.data.goals || 'Not provided'}</dd>
                <dt>Therapist</dt>
                <dd>
                  {profile.data.therapist_name || 'Not provided'}
                  {profile.data.therapist_email &&
                    ` · ${profile.data.therapist_email}`}
                </dd>
              </dl>
            </section>
          )}
        </DataStatus>
        <DataStatus loading={overview.isPending} error={overview.error}>
          {overview.data && (
            <div className="kpi-grid">
              <KpiTile label="Sessions" value={overview.data.sessions} />
              <KpiTile label="Attempts" value={overview.data.attempts} />
              <KpiTile
                label="Days practiced, last 7"
                value={overview.data.days_practiced_last_7}
              />
              <KpiTile label="Evaluations" value={overview.data.evaluations} />
            </div>
          )}
        </DataStatus>
        <section className="card therapist-summary">
          <h2>Therapist summary</h2>
          <DataStatus loading={summaries.isPending} error={summaries.error}>
            {latest ? (
              <>
                <p className="muted">
                  Generated {formatDate(latest.created_at)} · Last{' '}
                  {latest.days ?? 7} days · Model: {latest.model}
                </p>
                <p className="summary-copy">{latest.text}</p>
                {latest.model === 'fixture' && <DemoBadge />}
              </>
            ) : (
              <p>No summary generated yet.</p>
            )}
          </DataStatus>
          <button
            className="no-print"
            disabled={generate.isPending || summaries.isPending}
            onClick={() => generate.mutate({ kind: 'therapist', days: 7 })}
          >
            {generate.isPending ? 'Generating…' : 'Generate (last 7 days)'}
          </button>
          {generate.isPending && (
            <p role="status">Preparing the therapist summary…</p>
          )}
          {generate.isError && (
            <p role="status">
              Summary unavailable. Check the Gemini connection and try again.
            </p>
          )}
        </section>
        <div className="actions no-print">
          <ExportButtons />
          <button onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </section>
      <section className="report-page data-section">
        <h2>Active range over sessions</h2>
        <p>
          Mean best finger position during the active attempt, all poses.
          Compare the same pose in History. Higher is better for closing; lower
          for opening.
        </p>
        {hasDemo && <DemoBadge />}
        <DataStatus error={rom.error || sessions.error}>
          <TrendSmallMultiples
            points={rom.data ?? []}
            timeline={sessions.data}
            loading={rom.isPending || sessions.isPending}
            compact
          />
        </DataStatus>
      </section>
      <section className="report-page data-section">
        <h2>Assistance over sessions</h2>
        <p>Per-finger gap to target and rate of assisted attempts.</p>
        {hasDemo && <DemoBadge />}
        <DataStatus error={assist.error || sessions.error}>
          <div className="chart-grid">
            {GLOVE_FINGERS.map((finger) => (
              <AssistTrend
                key={finger}
                finger={finger}
                points={assist.data ?? []}
                timeline={sessions.data}
                loading={assist.isPending || sessions.isPending}
                compact
              />
            ))}
          </div>
        </DataStatus>
      </section>
      <section className="report-page data-section">
        <h2>Resistance over evaluations</h2>
        <p>
          Mean excess current over 20–90% position. Fast − slow is a
          velocity-dependence estimate. Review friction calibration and
          incomplete sweeps in evaluation details.
        </p>
        {hasDemo && <DemoBadge />}
        <DataStatus error={resistance.error || evaluations.error}>
          <div className="chart-grid">
            {GLOVE_FINGERS.map((finger) => (
              <ResistanceSlowFast
                key={finger}
                finger={finger}
                points={resistance.data ?? []}
                timeline={evaluations.data}
                loading={resistance.isPending || evaluations.isPending}
                compact
              />
            ))}
          </div>
        </DataStatus>
      </section>
    </section>
  );
}
