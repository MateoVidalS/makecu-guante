import { useState } from 'react';
import { POSES, type PoseId } from '../../contracts/poses';
import type { Summary } from '../../contracts/api';
import { EvaluationList, SessionList } from '../History';
import {
  Button,
  ButtonLink,
  PageHeader,
  DescriptionList,
  Select,
} from '../../design-system';
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
import { LEGACY_GLOVE } from '../../components/charts/direction';
import { firstAndLast, useAllSessions } from '../History/data';
import { DoctorChat } from './chat/DoctorChat';
import { ExportButtons } from './ExportButtons';
import './doctor.css';
import { TherapyReview } from './TherapyReview';

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

export default function Doctor() {
  const profile = useProfile(),
    overview = useHistoryOverview(),
    sessions = useAllSessions(),
    evaluations = useEvaluations();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pose, setPose] = useState<PoseId | ''>('open');
  const filteredRom = useHistoryRom(pose ? { pose } : {});
  const rom = useHistoryRom({ pose: 'open' }),
    assist = useHistoryAssist(),
    resistance = useHistoryResistance();
  // A stored summary describes the records that existed when it was generated. The backend
  // regenerates it after each session; until the new one lands, say the shown one is older
  // than the charts, and look for the fresh one every 15 s.
  const newestRecord = Math.max(
    ...(sessions.data ?? []).map((s) => Date.parse(s.ended_at ?? s.started_at)),
    ...(evaluations.data ?? []).map((e) => Date.parse(e.ended_at)),
    -Infinity,
  );
  const newest = (list?: Summary[]) =>
    list
      ?.slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const summaries = useSummaries(
      { kind: 'therapist', limit: 20 },
      {
        refetchInterval: (data) => {
          const shown = newest(data);
          return shown && Date.parse(shown.created_at) < newestRecord
            ? 15_000
            : false;
        },
      },
    ),
    generate = useCreateSummary();
  const latest = newest(summaries.data);
  const stale = !!latest && Date.parse(latest.created_at) < newestRecord;
  const demoSessions = !!sessions.data?.some((s) => s.is_demo);
  const demoEvaluations = !!evaluations.data?.some((e) => e.is_demo);
  const hasDemo = demoSessions || demoEvaluations;
  return (
    <section className="data-page doctor-report">
      <p className="footnote">
        {LEGACY_GLOVE} records are muted. Comparisons use the same glove
        direction.
      </p>
      <section className="report-page">
        <PageHeader
          eyebrow="memo · Clinical review"
          title="Practice and movement report"
          lead={`Prepared ${formatDate(Date.now())}. Estimates inspired by clinical practice; not validated medical measurements.${hasDemo ? ' Includes demo data.' : ''}`}
          actions={
            <div className="report-actions no-print">
              <ButtonLink to="/evaluate" size="sm">
                Evaluate movement
              </ButtonLink>
              <ExportButtons size="sm" />
              <Button size="sm" onClick={() => window.print()}>
                Print / Save PDF
              </Button>
            </div>
          }
        />
        <div data-chat-section="summary">
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
                variant="primary"
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
                <>
                  {stale && (
                    <p role="status" className="footnote summary-stale">
                      Generated before the latest sessions or evaluations, so it
                      may not match the charts below. Generate again for an
                      up-to-date summary.
                    </p>
                  )}
                  <p className="summary-copy">{latest.text}</p>
                </>
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
        </div>
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
        <div data-chat-section="glance">
          <DataSection
            title="At a glance"
            description={`Blue: active opening in open poses. Orange: opening the glove completed.${hasDemo ? ' Demo data is drawn hollow.' : ''}`}
            className="report-glance"
          >
            <div className="report-glance__grid">
              <HandRangeMap
                {...handFromOverview(overview.data, sessions.data, rom.data)}
                {...firstAndLast(sessions.data)}
                mirror={profile.data?.affected_hand === 'left'}
                loading={overview.isPending || sessions.isPending}
                compact
              />
              <LatestEffortBars
                timeline={sessions.data}
                rom={rom.data ?? []}
                assist={assist.data ?? []}
                loading={
                  rom.isPending || assist.isPending || sessions.isPending
                }
              />
              <PracticeCalendar
                sessions={sessions.data ?? []}
                loading={sessions.isPending}
              />
              <ResistanceDumbbells
                points={resistance.data ?? []}
                loading={resistance.isPending}
                compact
                hint="Extra motor current. Circle: slow sweep. Diamond: fast sweep. The bar is fast − slow, a velocity-dependence estimate. Check friction calibration and incomplete sweeps in evaluation details."
              />
            </div>
          </DataSection>
        </div>
      </section>
      <DataStatus loading={profile.isPending} error={profile.error}>
        {profile.data &&
          [
            profile.data.pseudonym,
            profile.data.condition,
            profile.data.goals,
            profile.data.therapist_name,
            profile.data.therapist_email,
          ].some((value) => value?.trim()) && (
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
      <details
        className="report-details"
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary>Details</summary>
        <div data-chat-section="range">
          {detailsOpen && (
            <section className="report-page">
              <DataSection
                title="Active range over sessions"
                description="Mean best finger position during the active attempt, all poses. Higher is better for closing, lower for opening. Choose one pose for a clearer comparison."
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
                <DataStatus error={filteredRom.error || sessions.error}>
                  <TrendSmallMultiples
                    points={filteredRom.data ?? []}
                    timeline={sessions.data}
                    loading={filteredRom.isPending || sessions.isPending}
                    opening={pose === 'open'}
                    compact
                  />
                </DataStatus>
              </DataSection>
            </section>
          )}
        </div>
        <div data-chat-section="assistance">
          {detailsOpen && (
            <DataSection
              className="report-page"
              title="Assistance over sessions"
              description="Per session: active opening in open poses (blue); mean opening the glove completed across attempts (orange)."
              demo={demoSessions}
              demoNote="Demo data is drawn hollow"
            >
              <DataStatus error={assist.error || rom.error}>
                <EffortSmallMultiples
                  timeline={sessions.data}
                  rom={rom.data ?? []}
                  assist={assist.data ?? []}
                  loading={
                    assist.isPending || rom.isPending || sessions.isPending
                  }
                />
              </DataStatus>
            </DataSection>
          )}
        </div>
      </details>
      <div data-chat-section="therapy">
        <TherapyReview sessions={sessions.data ?? []} />
      </div>
      <div data-chat-section="sessions">
        <SessionList doctor />
      </div>
      <div data-chat-section="evaluations">
        <EvaluationList />
      </div>
      <DoctorChat patient={profile.data?.pseudonym} demo={hasDemo} />
    </section>
  );
}
