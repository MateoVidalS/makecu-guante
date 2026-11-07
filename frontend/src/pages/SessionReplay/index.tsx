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
import { POSES } from '../../contracts/poses';
import {
  DataStatus,
  DemoBadge,
  KpiTile,
  ReplayChart,
  formatDate,
  percentage,
  fingerName,
} from '../../components/charts';

function AttemptReplay({ attempt, demo }: { attempt: Attempt; demo: boolean }) {
  const trace = useAttemptTrace(attempt.id);
  return (
    <section className="data-section">
      <h2>
        {POSES[attempt.pose].name} · Rep {attempt.rep}
      </h2>
      <p>
        {attempt.interrupted
          ? 'This attempt was interrupted.'
          : attempt.reached_active
            ? 'You did that on your own.'
            : 'The glove helped with the rest.'}
      </p>
      <div className="kpi-grid">
        <KpiTile label="On your own" value={percentage(attempt.active_ratio)} />
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
          value={percentage(
            (() => {
              const scored = attempt.fingers.filter(
                (f) => f.scored && f.assist_needed != null,
              );
              return scored.length
                ? scored.reduce((sum, f) => sum + f.assist_needed!, 0) /
                    scored.length
                : null;
            })(),
          )}
        />
        <KpiTile label="Safety events" value={attempt.safety_events.length} />
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
              {[
                'Finger',
                'Target',
                'Best on your own',
                'Help needed',
                'Final',
              ].map((s) => (
                <th key={s} scope="col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attempt.fingers
              .filter((f) => f.scored)
              .map((f) => (
                <tr key={f.finger}>
                  <th scope="row">{fingerName(f.finger)}</th>
                  <td>{percentage(f.target)}</td>
                  <td>{percentage(f.active_max)}</td>
                  <td>{percentage(f.assist_needed)}</td>
                  <td>{percentage(f.final)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Servo position is commanded; the servo cannot report its physical
        position.
      </p>
    </section>
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
      <Link to="/history?tab=sessions">Back to sessions</Link>
      <PageHeader
        title="Session replay"
        lead="Estimated from the camera — not a medical measurement."
      />
      <DataStatus loading={session.isPending} error={session.error}>
        {detail && (
          <>
            <p>
              {formatDate(detail.started_at)} {detail.is_demo && <DemoBadge />}
            </p>
            {attempts.length === 0 ? (
              <p>No attempts recorded in this session.</p>
            ) : (
              <>
                <div className="actions">
                  <Button
                    disabled={selected === 0}
                    onClick={() => setIndex(selected - 1)}
                  >
                    ← Previous attempt
                  </Button>
                  <Select
                    label="Attempt"
                    value={selected}
                    onChange={(e) => setIndex(Number(e.target.value))}
                  >
                    {attempts.map((a, i) => (
                      <option key={a.id} value={i}>
                        {i + 1}. {POSES[a.pose].name} · Rep {a.rep}
                      </option>
                    ))}
                  </Select>
                  <Button
                    disabled={selected === attempts.length - 1}
                    onClick={() => setIndex(selected + 1)}
                  >
                    Next attempt →
                  </Button>
                </div>
                <AttemptReplay
                  key={attempts[selected].id}
                  attempt={attempts[selected]}
                  demo={detail.is_demo}
                />
              </>
            )}
            <details className="card">
              <summary>Session transcript</summary>
              {detail.transcript.length === 0 ? (
                <p>No transcript recorded.</p>
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
            <Inline>
              <Button variant="quiet" onClick={() => setConfirm(true)}>
                Delete session
              </Button>
            </Inline>
          </>
        )}
      </DataStatus>
    </section>
  );
}
