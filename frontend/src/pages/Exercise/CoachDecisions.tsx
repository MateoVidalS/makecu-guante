import { useEffect, useState } from 'react';
import type { TherapyApi } from '../../contracts/therapist';
import { Button, Dialog } from '../../design-system';
import { canUndo, decisionLabel } from '../../components/therapy/data';
import { CoachTimeline } from '../../components/therapy/CoachTimeline';

export function CoachDecisions({
  therapy,
  onBrake,
  sessionId,
}: {
  therapy?: TherapyApi;
  onBrake: () => void;
  sessionId: number | null;
}) {
  const [decisions, setDecisions] = useState(() => therapy?.decisions() ?? []);
  const [feelings, setFeelings] = useState(() => therapy?.feelings() ?? []);
  const [history, setHistory] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const refresh = () => {
      setMessage('');
      setDecisions([...(therapy?.decisions() ?? [])]);
      setFeelings([...(therapy?.feelings() ?? [])]);
    };
    refresh();
    setMessage('');
    setCheckIn(false);
    return therapy?.onDecision((decision) => {
      refresh();
      if (decision.tool === 'brake' && decision.result !== 'rejected') {
        setCheckIn(false);
        setHistory(false);
      }
    });
  }, [therapy, sessionId]);
  const latest = decisions.at(-1);
  const brake = () => {
    onBrake();
    setCheckIn(false);
    setHistory(false);
    setMessage('Glove released. Practice paused.');
  };
  function recordPain(pain: number) {
    if (!therapy || fatigue == null) return;
    // The runtime records and immediately brakes at its pain threshold.
    const decision = therapy.recordFeeling({
      pain,
      fatigue,
      note: '',
      source: 'ui',
    });
    setMessage(
      decision.result === 'rejected'
        ? decision.reason
        : pain >= therapy.limits.pain_brake_at
          ? 'Glove released. Practice paused.'
          : 'Your feeling is recorded.',
    );
    if (decision.result !== 'rejected') setCheckIn(false);
  }
  return (
    <>
      <section className="therapy-live" aria-label="Coach decisions">
        <div className="therapy-live__copy" aria-live="polite">
          <strong>Coach decisions</strong>
          <p>
            {message ||
              (latest
                ? `${decisionLabel(latest)} · ${latest.result}. ${latest.reason}`
                : therapy
                  ? 'Your coach will show changes here.'
                  : 'Coach adjustments are unavailable.')}
          </p>
        </div>
        <Button
          size="lg"
          disabled={!therapy || !canUndo(decisions)}
          onClick={() => {
            const decision = therapy?.undo();
            setMessage(decision ? decision.reason : 'No adjustment to undo.');
          }}
        >
          Undo
        </Button>
        <Button
          size="lg"
          disabled={!therapy}
          onClick={() => {
            setFatigue(null);
            setCheckIn(true);
          }}
        >
          How I feel
        </Button>
        <Button size="lg" onClick={() => setHistory(true)}>
          Timeline
        </Button>
      </section>
      <Dialog
        open={history}
        onClose={() => setHistory(false)}
        title="Coach decisions"
        size="lg"
        footer={
          <Button size="lg" variant="danger" onClick={brake}>
            Brake
          </Button>
        }
      >
        <CoachTimeline
          decisions={decisions}
          feelings={feelings}
          startedAt={
            decisions[0]?.t ?? feelings[0]?.t ?? new Date().toISOString()
          }
        />
      </Dialog>
      <Dialog
        open={checkIn}
        onClose={() => setCheckIn(false)}
        size="lg"
        className="feeling-dialog"
        title={fatigue == null ? 'How tired is your hand?' : 'How much pain?'}
        description={
          fatigue == null
            ? '0 means rested. 10 means very tired.'
            : '0 means no pain. 10 means the most pain.'
        }
        footer={
          <>
            {fatigue != null && (
              <Button size="lg" onClick={() => setFatigue(null)}>
                Back
              </Button>
            )}
            <Button size="lg" variant="danger" onClick={brake}>
              Brake
            </Button>
          </>
        }
      >
        <p className="feeling-help">
          {fatigue == null
            ? 'First, choose tiredness. Then choose pain.'
            : `Pain ${therapy?.limits.pain_brake_at ?? 4} or more releases the glove immediately.`}
        </p>
        <div
          className="feeling-scale"
          role="group"
          aria-label={
            fatigue == null ? 'Fatigue from 0 to 10' : 'Pain from 0 to 10'
          }
        >
          {Array.from({ length: 11 }, (_, value) => (
            <Button
              key={value}
              size="lg"
              onClick={() =>
                fatigue == null ? setFatigue(value) : recordPain(value)
              }
            >
              {value}
            </Button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
