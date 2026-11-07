import type { CoachDecision, FeelingEntry } from '../../contracts/therapist';
import { decisionLabel, elapsedTime } from './data';
import './therapy.css';

const sources = {
  coach: 'Coach',
  local_rule: 'Local safety rule',
  patient_ui: 'Patient button',
};

export function DecisionDetail({ decision }: { decision: CoachDecision }) {
  return (
    <details className="therapy-audit">
      <summary>Decision details</summary>
      <p>
        {sources[decision.source]} · {decision.tool}
      </p>
      <dl>
        <dt>Requested</dt>
        <dd>
          <pre>{JSON.stringify(decision.requested, null, 2)}</pre>
        </dd>
        <dt>Applied</dt>
        <dd>
          <pre>{JSON.stringify(decision.applied, null, 2)}</pre>
        </dd>
      </dl>
    </details>
  );
}

/** A single time axis keeps feelings and decisions in their recorded order. */
export function CoachTimeline({
  decisions = [],
  feelings = [],
  startedAt,
}: {
  decisions?: CoachDecision[];
  feelings?: FeelingEntry[];
  startedAt: string;
}) {
  const events = [
    ...decisions.map((d, i) => ({
      t: d.t,
      key: `decision-${d.id}-${i}`,
      decision: d,
      feeling: null,
    })),
    ...feelings.map((f, i) => ({
      t: f.t,
      key: `feeling-${i}`,
      decision: null,
      feeling: f,
    })),
  ].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (!events.length)
    return <p className="footnote">No coach decisions or feelings recorded.</p>;
  return (
    <ol
      className="therapy-timeline"
      aria-label="Coach decisions and feelings timeline"
    >
      {events.map(({ t, key, decision, feeling }) => (
        <li key={key}>
          <time dateTime={t} title={t}>
            {elapsedTime(t, startedAt)}
          </time>
          <div>
            {decision ? (
              <>
                <p>
                  <strong>{decisionLabel(decision)}</strong> · {decision.result}
                </p>
                <p>{decision.reason}</p>
                {decision.tool === 'note_for_therapist' &&
                  decision.result !== 'rejected' &&
                  typeof (decision.applied?.text ?? decision.requested.text) ===
                    'string' && (
                    <p>
                      Therapist note:{' '}
                      {String(
                        decision.applied?.text ?? decision.requested.text,
                      )}
                    </p>
                  )}
                <DecisionDetail decision={decision} />
              </>
            ) : (
              feeling && (
                <>
                  <p>
                    <strong>
                      Pain {feeling.pain}/10 · Fatigue {feeling.fatigue}/10
                    </strong>
                  </p>
                  <p>
                    {feeling.source === 'ui'
                      ? 'Patient button'
                      : 'Voice check-in'}
                    {feeling.attempt_index != null
                      ? ` · Attempt ${feeling.attempt_index + 1}`
                      : ''}
                  </p>
                  {feeling.note && <p>{feeling.note}</p>}
                </>
              )
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
