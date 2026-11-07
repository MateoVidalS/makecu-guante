import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useGlove, useGloveTelemetry } from '../../glove';
import { useVisionFrame } from '../../vision';
import { useRuntime, useExerciseView } from '../../runtime';
import type {
  AttemptResult,
  EngineEvent,
  ExercisePhase,
  SessionSummary,
} from '../../contracts/engine';
import { GLOVE_FINGERS } from '../../contracts/glove';
import type { PoseDef } from '../../contracts/poses';
import './live.css';
export const percent = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v * 100)}%`;
export const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function BigButton({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  return (
    <button className={`${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function StatusChip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}
export function GloveChip() {
  const { store } = useGlove();
  const connection = useStore(store, (s) => s.connection);
  const state = useGloveTelemetry((t) => t?.st);
  const mode = useGloveTelemetry((t) => t?.md);
  const phase = useExerciseView((v) => v.phase);
  const label =
    connection !== 'connected'
      ? 'Not connected'
      : state === 'fault' || phase === 'PAUSED'
        ? 'Stopped'
        : mode === 'target' || phase === 'ASSIST'
          ? 'Helping'
          : 'Ready';
  return <StatusChip>● Glove: {label}</StatusChip>;
}
export function CameraChip() {
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  return (
    <StatusChip>◉ Camera: {seen ? 'Sees hand' : "Can't see hand"}</StatusChip>
  );
}
export const phaseLabels: Record<ExercisePhase, string> = {
  PRESENT: 'Get ready',
  ATTEMPT: 'Try now',
  HOLD: 'Hold it',
  ASSIST: 'The glove is helping',
  ASSIST_HOLD: 'Hold it',
  RELEASE: 'Relax your hand',
  REST: 'Relax your hand',
  PAUSED: 'Paused',
  DONE: 'Session complete',
};
export function PhaseRing({
  phase,
  elapsed,
  duration,
  waiting = false,
}: {
  phase: ExercisePhase;
  elapsed: number;
  duration: number | null;
  waiting?: boolean;
}) {
  const progress = duration ? Math.min(1, elapsed / duration) : 0;
  return (
    <div
      className={`phase-ring phase-${phase.toLowerCase()}`}
      style={{ '--progress': `${progress * 360}deg` } as CSSProperties}
    >
      <span aria-hidden="true">
        {waiting ? '◉' : phase === 'PAUSED' ? 'Ⅱ' : '◔'}
      </span>
      <strong aria-live="polite">
        {waiting ? 'Show me your hand' : phaseLabels[phase]}
      </strong>
    </div>
  );
}
export function FingerBars({
  pose,
  activeMax = {},
  assisting = false,
}: {
  pose: PoseDef;
  activeMax?: Partial<Record<string, number>>;
  assisting?: boolean;
}) {
  const closure = useVisionFrame((f) => f?.closure);
  return (
    <div className="finger-bars" aria-label="Finger movement estimates">
      {GLOVE_FINGERS.map((f) => {
        const value = closure?.[f],
          active = activeMax[f],
          target = pose.closure[f];
        return (
          <div className="finger" key={f}>
            <strong>{percent(value)}</strong>
            <div
              className="finger-track"
              role="meter"
              aria-label={`${title(f)} movement`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                value == null ? undefined : Math.round(value * 100)
              }
            >
              <div
                className="finger-fill"
                style={{
                  height: percent(Math.min(1, value ?? 0)),
                  background: assisting ? 'var(--assist)' : 'var(--active)',
                }}
              />
              {assisting && active != null && (
                <div
                  className="finger-fill"
                  style={{
                    height: percent(Math.min(1, active)),
                    background: 'var(--active)',
                  }}
                />
              )}
              {target != null && (
                <span
                  className="target-mark"
                  style={{ bottom: percent(target) }}
                  title={`Target ${percent(target)}`}
                />
              )}
              {active != null && (
                <span
                  className="active-mark"
                  style={{ bottom: percent(active) }}
                  title={`On your own ${percent(active)}`}
                />
              )}
            </div>
            <span>{title(f)}</span>
          </div>
        );
      })}
    </div>
  );
}
type Safety = Extract<EngineEvent, { kind: 'safety' }>;
const safetyCopy: Record<Safety['source'], string> = {
  overcurrent: 'Stopping. I felt resistance in your hand.',
  stop_button: 'Stopped. Take your time.',
  watchdog: 'The glove stopped. Check the connection.',
  camera_lost: "I can't see your hand. Move it into view.",
  glove_disconnected: 'The glove disconnected. Check the USB cable.',
};
export function SafetyBanner() {
  const runtime = useRuntime(),
    { client } = useGlove();
  const [event, setEvent] = useState<Safety | null>(null),
    [releasing, setReleasing] = useState(false);
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      runtime.exercise.onEvent((e) => {
        if (e.kind === 'safety') {
          setEvent(e);
          setReleasing(false);
        }
      }),
    [runtime],
  );
  useEffect(() => {
    if (event) resume.current?.focus();
  }, [event]);
  useEffect(
    () =>
      runtime.exercise.subscribe((v) => {
        if (v.phase === 'DONE' || v.phase === 'REST') {
          setEvent(null);
          setReleasing(false);
        }
      }),
    [runtime],
  );
  useEffect(
    () =>
      client.onTelemetry((t) => {
        if (releasing && t.st === 'idle') {
          setEvent(null);
          setReleasing(false);
        }
      }),
    [client, releasing],
  );
  if (!event) return null;
  return (
    <section className="safety-banner" role="alert" aria-label="Safety stop">
      <strong>
        ⚠ {releasing ? 'Releasing the glove…' : safetyCopy[event.source]}
      </strong>
      <button
        ref={resume}
        disabled={releasing}
        onClick={() => {
          setReleasing(true);
          runtime.exercise.resume();
        }}
      >
        Resume
      </button>
      <details>
        <summary>What happened?</summary>
        <p>
          {event.source.replaceAll('_', ' ')}
          {event.finger ? ` · ${event.finger}` : ''}
          {event.ma != null ? ` · ${event.ma} mA` : ''}
        </p>
      </details>
    </section>
  );
}
export function AttemptToast({ result }: { result: AttemptResult | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(!!result);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [result]);
  if (!result || !visible) return null;
  return (
    <div className="attempt-toast" role="status">
      {result.fingers
        .filter((f) => f.scored)
        .map((f) => (
          <span key={f.finger}>
            {title(f.finger)} {percent(f.active_max)} on your own · glove helped{' '}
            {percent(f.assist_needed)}{' '}
          </span>
        ))}
      {result.time_to_position_s != null && (
        <span>Reached in {result.time_to_position_s.toFixed(1)} seconds</span>
      )}
    </div>
  );
}
export function SessionSummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <section className="card">
      <h2>Session complete</h2>
      <p>
        {summary.attempts} attempts · {summary.reached_active} on your own ·{' '}
        {summary.assisted} with help
      </p>
      <div className="summary-fingers">
        {summary.per_finger.map((f) => {
          const previous = summary.previous?.per_finger.find(
            (p) => p.finger === f.finger,
          )?.active_max_mean;
          const delta =
            f.active_max_mean != null && previous != null
              ? f.active_max_mean - previous
              : null;
          return (
            <div key={f.finger}>
              <h3>{title(f.finger)}</h3>
              <strong>{percent(f.active_max_mean)}</strong>
              {delta != null && (
                <p className="muted">
                  {delta >= 0 ? '▲ +' : '▼ '}
                  {Math.round(delta * 100)}% vs last time
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted">Estimates of movement on your own.</p>
    </section>
  );
}
export function Stepper({
  labels,
  step,
  onStep,
}: {
  labels: string[];
  step: number;
  onStep: (step: number) => void;
}) {
  return (
    <ol className="stepper" aria-label="Calibration steps">
      {labels.map((label, i) => (
        <li key={label} aria-current={step === i ? 'step' : undefined}>
          <button disabled={i > step} onClick={() => onStep(i)}>
            {i < step ? '✓' : i + 1} {label}
          </button>
        </li>
      ))}
    </ol>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}
export function Toasts() {
  return (
    <div
      id="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    />
  );
}
export function ConfirmDialog({
  title: heading,
  children,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute('open', '');
    return () => prior?.focus();
  }, []);
  return (
    <dialog
      className="confirm-dialog"
      ref={dialog}
      aria-labelledby="confirm-heading"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          const buttons = dialog.current!.querySelectorAll('button');
          if (e.shiftKey && document.activeElement === buttons[0]) {
            e.preventDefault();
            buttons[buttons.length - 1].focus();
          } else if (
            !e.shiftKey &&
            document.activeElement === buttons[buttons.length - 1]
          ) {
            e.preventDefault();
            buttons[0].focus();
          }
        }
      }}
    >
      <h2 id="confirm-heading">{heading}</h2>
      {children}
      <div className="actions">
        <BigButton autoFocus onClick={onCancel}>
          Keep practicing
        </BigButton>
        <BigButton onClick={onConfirm}>End session</BigButton>
      </div>
    </dialog>
  );
}
export function BrowserSupportBanner() {
  return 'serial' in navigator ? null : (
    <aside className="card">
      Use Chrome or Edge to connect the glove.{' '}
      <Link to="/setup">Use simulator</Link> to practice here.
    </aside>
  );
}
/** Page unmount and browser departure always request a runtime stop. */
export function useSessionLeaveGuard(kind: 'exercise' | 'evaluation') {
  const runtime = useRuntime(),
    { client } = useGlove();
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      const active =
        kind === 'exercise'
          ? runtime.exercise.view().phase !== 'DONE'
          : ['prepare', 'sweep', 'cooldown'].includes(
              runtime.evaluation.view().stage,
            );
      if (active) {
        client.release();
        void runtime[kind].stop();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      void runtime[kind].stop();
    };
  }, [runtime, client, kind]);
}
