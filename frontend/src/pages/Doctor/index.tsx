import { Button, PageHeader, DescriptionList } from '../../design-system';
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
} from '../../components/charts';
import { firstAndLast, useAllSessions } from '../History/data';
import { ExportButtons } from './ExportButtons';
import './doctor.css';

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

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
  const demoSessions = !!sessions.data?.some((s) => s.is_demo);
  const demoEvaluations = !!evaluations.data?.some((e) => e.is_demo);
  const hasDemo = demoSessions || demoEvaluations;
  return (
    <section className="data-page doctor-report">
      <section className="report-page">
        <PageHeader
          eyebrow="Rehab Hub · Clinical review"
          title="Practice and movement report"
          lead={`Prepared ${formatDate(Date.now())}. Estimates inspired by clinical practice; not validated medical measurements.${hasDemo ? ' Includes demo data.' : ''}`}
          actions={
            <div className="report-actions no-print">
              <ExportButtons size="sm" />
              <Button size="sm" onClick={() => window.print()}>
                Print / Save PDF
              </Button>
            </div>
          }
        />
        <DataStatus loading={overview.isPending} error={overview.error}>
          {overview.data && (
            <KpiRow>
              <KpiTile label="Sessions" value={overview.data.sessions} />
              <KpiTile label="Attempts" value={overview.data.attempts} />
              <KpiTile
                label="Days practiced, last 7"
                value={overview.data.days_practiced_last_7}
              />
              <KpiTile label="Evaluations" value={overview.data.evaluations} />
            </KpiRow>
          )}
        </DataStatus>
        <DataSection
          title="At a glance"
          description={`Blue: on their own. Orange: glove helped.${hasDemo ? ' Demo data is drawn hollow.' : ''}`}
          className="report-glance"
        >
          <div className="report-glance__grid">
            <HandRangeMap
              {...handFromOverview(overview.data)}
              {...firstAndLast(sessions.data)}
              mirror={profile.data?.affected_hand === 'left'}
              loading={overview.isPending || sessions.isPending}
              compact
            />
            <LatestEffortBars
              rom={rom.data ?? []}
              assist={assist.data ?? []}
              loading={rom.isPending || assist.isPending}
            />
            <ResistanceDumbbells
              points={resistance.data ?? []}
              loading={resistance.isPending}
              compact
              hint="Extra motor current. Circle: slow sweep. Diamond: fast sweep. The bar is fast − slow, a velocity-dependence estimate. Check friction calibration and incomplete sweeps in evaluation details."
            />
            <PracticeCalendar
              sessions={sessions.data ?? []}
              loading={sessions.isPending}
            />
          </div>
        </DataSection>
      </section>
      <section className="report-page">
        <DataStatus loading={profile.isPending} error={profile.error}>
          {profile.data && (
            <DataSection
              title={profile.data.pseudonym || 'Patient profile'}
              className="report-patient"
            >
              <DescriptionList
                className="report-dl"
                items={[
                  {
                    label: 'Affected hand',
                    value: capitalize(profile.data.affected_hand),
                  },
                  {
                    label: 'Condition',
                    value: profile.data.condition || 'Not provided',
                  },
                  {
                    label: 'Goals',
                    value: profile.data.goals || 'Not provided',
                  },
                  {
                    label: 'Therapist',
                    value:
                      [
                        profile.data.therapist_name,
                        profile.data.therapist_email,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Not provided',
                  },
                ]}
              />
            </DataSection>
          )}
        </DataStatus>
        <DataSection
          title="Therapist summary"
          className="therapist-summary"
          description={
            latest
              ? `Generated ${formatDate(latest.created_at)} · Last ${latest.days ?? 7} days · Model: ${latest.model}${latest.model === 'fixture' ? ' (Demo data)' : ''}`
              : undefined
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              className="no-print"
              disabled={generate.isPending || summaries.isPending}
              onClick={() => generate.mutate({ kind: 'therapist', days: 7 })}
            >
              {generate.isPending ? 'Generating…' : 'Generate (last 7 days)'}
            </Button>
          }
        >
          <DataStatus loading={summaries.isPending} error={summaries.error}>
            {latest ? (
              <p className="summary-copy">{latest.text}</p>
            ) : (
              <p className="footnote">No summary generated yet.</p>
            )}
          </DataStatus>
          {generate.isPending && (
            <p role="status" className="footnote">
              Preparing the therapist summary…
            </p>
          )}
          {generate.isError && (
            <p role="status" className="footnote">
              Summary unavailable. Check the Gemini connection and try again.
            </p>
          )}
        </DataSection>
      </section>
      <section className="report-page">
        <DataSection
          title="Active range over sessions"
          description="Mean best finger position during the active attempt, all poses. Higher is better for closing, lower for opening. Compare a single pose in History."
          demo={demoSessions}
        >
          <DataStatus error={rom.error || sessions.error}>
            <TrendSmallMultiples
              points={rom.data ?? []}
              timeline={sessions.data}
              loading={rom.isPending || sessions.isPending}
              compact
            />
          </DataStatus>
        </DataSection>
      </section>
      <DataSection
        className="report-page"
        title="Assistance over sessions"
        description="Per session: best closure on its own (blue) and what the glove added to reach the target (orange). All poses."
        demo={demoSessions}
        demoNote="Demo data is drawn hollow"
      >
        <DataStatus error={assist.error || rom.error}>
          <EffortSmallMultiples
            rom={rom.data ?? []}
            assist={assist.data ?? []}
            loading={assist.isPending || rom.isPending}
          />
        </DataStatus>
      </DataSection>
    </section>
  );
}
