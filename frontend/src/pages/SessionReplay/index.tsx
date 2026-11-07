import {
  Button,
  Dialog,
  Inline,
  PageHeader,
  Select,
} from '../../design-system';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  useAttemptTrace,
  useDeleteSession,
  useSession,
} from '../../api/client';
import type { Attempt } from '../../contracts/api';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { POSES } from '../../contracts/poses';
import './replay.css';
import {
  DataSection,
  DataStatus,
  KpiRow,
  KpiTile,
  ReplayChart,
  AttemptHand,
  handFromAttempt,
  formatDate,
  percentage,
  fingerName,
} from '../../components/charts';

const meanAssist = (attempt: Attempt) => {
  const scored = attempt.fingers.filter(
    (f) => f.scored && f.assist_needed != null,
  );
  return scored.length
    ? scored.reduce((sum, f) => sum + f.assist_needed!, 0) / scored.length
    : null;
};

function AttemptReplay({ attempt, demo }: { attempt: Attempt; demo: boolean }) {
  const trace = useAttemptTrace(attempt.id);
  return (
    <DataSection
      title={`${POSES[attempt.pose].name} · Rep ${attempt.rep}`}
      description={
        attempt.interrupted
          ? 'This attempt was interrupted.'
          : attempt.reached_active
            ? 'You did that on your own.'
            : 'The glove helped with the rest.'
      }
      demo={demo}
      demoNote="Demo data"
    >
      <div className="attempt-overview">
        <div className="data-stack">
          <KpiRow>
            <KpiTile
              label="On your own"
              value={percentage(attempt.active_ratio)}
            />
            <KpiTile
              label="Time to reach on your own"
              value={
                attempt.time_to_position_s == null
                  ? '—'
                  : `${attempt.time_to_position_s.toFixed(1)} s`
              }
            />
            <KpiTile
              label="Glove help needed"
              value={percentage(meanAssist(attempt))}
            />
            <KpiTile
              label="Safety events"
              value={attempt.safety_events.length}
            />
          </KpiRow>
        </div>
        <AttemptHand values={handFromAttempt(attempt.fingers)} demo={demo} />
      </div>
      <DataStatus error={trace.error}>
        <ReplayChart
          trace={trace.data}
          loading={trace.isPending}
          isDemo={demo}
          safety={attempt.safety_events}
        />
      </DataStatus>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption>Per-finger estimates from the camera</caption>
          <thead>
            <tr>
              <th scope="col">Finger</th>
              {['Target', 'Best on your own', 'Help needed', 'Final'].map(
                (s) => (
                  <th key={s} scope="col" className="num">
                    {s}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {GLOVE_FINGERS.map((finger) => {
              const f = attempt.fingers.find((f) => f.finger === finger);
              const measured =
                f &&
                (f.active_max != null ||
                  f.final != null ||
                  f.assist_needed != null);
              return (
                <tr key={finger}>
                  <th scope="row">{fingerName(finger)}</th>
                  <td className="num">
                    {f?.scored ? percentage(f.target) : '—'}
                  </td>
                  {measured ? (
                    <>
                      <td className="num">{percentage(f.active_max)}</td>
                      <td className="num">{percentage(f.assist_needed)}</td>
                      <td className="num">{percentage(f.final)}</td>
                    </>
                  ) : (
                    <td colSpan={3}>Not measured</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Servo position is commanded; the servo cannot report its physical
        position.
      </p>
    </DataSection>
  );
}
export default function SessionReplay() {
  const cache = useQueryClient();
  const { id } = useParams(),
    session = useSession(Number(id));
  const [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false);
  const deletion = useDeleteSession(),
    navigate = useNavigate();
  const detail = session.data,
    attempts = detail?.attempts ?? [];
  const selected = Math.min(index, Math.max(0, attempts.length - 1));
  return (
    <section className="data-page">
      <Link className="back-link" to="/history?tab=sessions">
        <span aria-hidden="true">← </span>Back to sessions
      </Link>
      <PageHeader
        title="Session replay"
        lead={
          detail
            ? `${formatDate(detail.started_at)} · Estimated from the camera, not a medical measurement.`
            : 'Estimated from the camera, not a medical measurement.'
        }
      />
      <DataStatus loading={session.isPending} error={session.error}>
        {detail && (
          <>
            {attempts.length === 0 ? (
              <p className="footnote">No attempts recorded in this session.</p>
            ) : (
              <>
                <div className="replay-nav">
                  <Select
                    label="Attempt"
                    layout="inline"
                    value={selected}
                    onChange={(e) => setIndex(Number(e.target.value))}
                  >
                    {attempts.map((a, i) => (
                      <option key={a.id} value={i}>
                        {i + 1}. {POSES[a.pose].name} · Rep {a.rep}
                      </option>
                    ))}
                  </Select>
                  <Inline gap={8}>
                    <Button
                      size="sm"
                      disabled={selected === 0}
                      onClick={() => setIndex(selected - 1)}
                    >
                      ← Previous attempt
                    </Button>
                    <Button
                      size="sm"
                      disabled={selected === attempts.length - 1}
                      onClick={() => setIndex(selected + 1)}
                    >
                      Next attempt →
                    </Button>
                  </Inline>
                  <span className="replay-nav__count">
                    {selected + 1} of {attempts.length}
                  </span>
                </div>
                <AttemptReplay
                  key={attempts[selected].id}
                  attempt={attempts[selected]}
                  demo={detail.is_demo}
                />
              </>
            )}
            <details className="replay-transcript">
              <summary>Session transcript</summary>
              {detail.transcript.length === 0 ? (
                <p className="footnote">No transcript recorded.</p>
              ) : (
                <ol>
                  {detail.transcript.map((line, i) => (
                    <li key={i}>
                      <time dateTime={line.t}>
                        {new Date(line.t).toLocaleTimeString('en', {
                          timeZone: 'UTC',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}{' '}
                        UTC
                      </time>{' '}
                      · <strong>{fingerName(line.role)}:</strong> {line.text}
                    </li>
                  ))}
                </ol>
              )}
            </details>
            <Dialog
              open={confirm}
              title="Delete this session?"
              onClose={() => {
                if (!deletion.isPending) setConfirm(false);
              }}
              description="This removes its attempts, traces, transcript, and summaries."
              footer={
                <Inline>
                  <Button
                    disabled={deletion.isPending}
                    onClick={() => setConfirm(false)}
                    data-autofocus
                  >
                    Keep session
                  </Button>
                  <Button
                    variant="danger"
                    disabled={deletion.isPending}
                    onClick={() =>
                      deletion.mutate(detail.id, {
                        onSuccess: () => {
                          void cache.invalidateQueries({
                            queryKey: ['summaries'],
                          });
                          detail.attempts.forEach((a) =>
                            cache.removeQueries({ queryKey: ['traces', a.id] }),
                          );
                          cache.removeQueries({
                            queryKey: ['sessions', detail.id],
                            exact: true,
                          });
                          navigate('/history?tab=sessions');
                        },
                      })
                    }
                  >
                    {deletion.isPending ? 'Deleting…' : 'Confirm delete'}
                  </Button>
                </Inline>
              }
            >
              {deletion.isError && (
                <p role="alert">
                  Could not delete this session. Please try again.
                </p>
              )}
            </Dialog>
            <div className="replay-footer">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setConfirm(true)}
              >
                Delete session
              </Button>
            </div>
          </>
        )}
      </DataStatus>
    </section>
  );
}
