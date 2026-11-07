import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
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
import {
  useToast,
  Heading,
  Button,
  Card,
  StatusChip as DSStatusChip,
  ProgressRing,
  Icon,
  Meter,
  Banner,
  Toast,
  Stepper as DSStepper,
  EmptyState as DSEmptyState,
  ConfirmDialog as DSConfirmDialog,
  KpiTile,
  Grid,
} from '../../design-system';
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
    <Button size="md" variant={variant} className={className} {...props}>
      {children}
    </Button>
  );
}
export function StatusChip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}
export function GloveChip() {
  const runtime = useRuntime();
  const [safetyStopped, setSafetyStopped] = useState(false);
  useEffect(() => {
    const events = runtime.exercise.onEvent((event) => {
      if (event.kind === 'safety') setSafetyStopped(true);
    });
    const phases = runtime.exercise.subscribe((view) => {
      if (view.phase === 'REST' || view.phase === 'DONE')
        setSafetyStopped(false);
    });
    return () => {
      events();
      phases();
    };
  }, [runtime]);
  const { store, client } = useGlove();
  const connection = useStore(store, (s) => s.connection);
  const state = useGloveTelemetry((t) => t?.st);
  const mode = useGloveTelemetry((t) => t?.md);
  const phase = useExerciseView((v) => v.phase);
  const label =
    safetyStopped || state === 'fault'
      ? 'Stopped'
      : connection !== 'connected'
        ? 'Not connected'
        : phase === 'PAUSED'
          ? 'Paused'
          : mode === 'target' || phase === 'ASSIST'
            ? 'Helping'
            : 'Ready';
  const tone =
    label === 'Stopped'
      ? 'danger'
      : label === 'Paused'
        ? 'neutral'
        : label === 'Helping'
          ? 'assist'
          : label === 'Ready'
            ? 'reached'
            : 'off';
  return (
    <DSStatusChip
      icon="glove"
      label="Glove"
      value={label}
      tone={tone}
      detail={client.kind === 'sim' ? 'Simulator' : undefined}
    />
  );
}
export function CameraChip() {
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  return (
    <DSStatusChip
      icon="camera"
      label="Camera"
      value={seen ? 'Sees hand' : "Can't see hand"}
      tone={seen ? 'reached' : 'caution'}
    />
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
  const label = waiting ? 'Show me your hand' : phaseLabels[phase];
  return (
    <div className="phase-ring" aria-live="polite">
      <ProgressRing
        value={waiting ? undefined : progress}
        label={label}
        tone={
          phase === 'PAUSED'
            ? 'neutral'
            : phase.startsWith('ASSIST')
              ? 'assist'
              : phase === 'HOLD'
                ? 'reached'
                : 'active'
        }
      >
        <Icon name={phase === 'PAUSED' ? 'pause' : 'hand'} />
      </ProgressRing>
      <strong>{label}</strong>
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
          active = activeMax[f];
        return (
          <Meter
            key={f}
            label={title(f)}
            value={value ?? 0}
            valueText={percent(value)}
            tone={assisting ? 'assist' : 'active'}
            target={pose.closure[f] ?? undefined}
            segments={
              assisting && active != null
                ? [
                    {
                      value: Math.min(active, value ?? 0),
                      tone: 'active',
                      label: 'On your own',
                    },
                    {
                      value: Math.max(0, (value ?? 0) - active),
                      tone: 'assist',
                      label: 'Glove helped',
                    },
                  ]
                : undefined
            }
          />
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
    <Banner
      tone="safety"
      title={releasing ? 'Releasing the glove…' : safetyCopy[event.source]}
      action={
        <Button
          ref={resume}
          size="lg"
          disabled={releasing}
          onClick={() => {
            setReleasing(true);
            runtime.exercise.resume();
          }}
        >
          Resume
        </Button>
      }
      details={
        <p>
          {event.source.replaceAll('_', ' ')}
          {event.finger ? ` · ${event.finger}` : ''}
          {event.ma != null ? ` · ${Math.round(event.ma)} mA` : ''}
        </p>
      }
    />
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
    <Toast
      className="attempt-toast"
      tone={result.assisted ? 'assist' : 'reached'}
      title={result.fingers
        .filter((f) => f.scored)
        .map((f) => `${title(f.finger)} ${percent(f.active_max)} on your own`)
        .join(' · ')}
      description={
        result.assisted
          ? 'The glove helped with the rest.'
          : 'You did that on your own.'
      }
    />
  );
}
export function SessionSummaryCard({ summary }: { summary: SessionSummary }) {
  return (
    <Card>
      <Heading level={1}>Session complete</Heading>
      <p>
        {summary.attempts} attempts · {summary.reached_active} on your own ·{' '}
        {summary.assisted} with help
      </p>
      <Grid columns={3}>
        {summary.per_finger.map((f) => {
          const previous = summary.previous?.per_finger.find(
            (p) => p.finger === f.finger,
          )?.active_max_mean;
          const delta =
            f.active_max_mean != null && previous != null
              ? Math.round((f.active_max_mean - previous) * 100)
              : undefined;
          return (
            <KpiTile
              key={f.finger}
              label={title(f.finger)}
              value={percent(f.active_max_mean)}
              delta={delta}
              deltaLabel="vs last time"
            />
          );
        })}
      </Grid>
      <p className="muted">Estimates of movement on your own.</p>
    </Card>
  );
}
export function Stepper({
  labels,
  step,
  onStep,
  disabled = false,
}: {
  disabled?: boolean;
  labels: string[];
  step: number;
  onStep: (step: number) => void;
}) {
  return (
    <DSStepper
      label="Calibration steps"
      steps={labels.map((label, i) => ({ id: String(i), label }))}
      current={String(step)}
      completed={labels.flatMap((_, i) => (i < step ? [String(i)] : []))}
      onSelect={disabled ? undefined : (id) => onStep(Number(id))}
    />
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <DSEmptyState title="Ready when you are">{children}</DSEmptyState>;
}
export function showToast(message: string, error = false) {
  window.dispatchEvent(
    new CustomEvent('rehab-toast', { detail: { message, error } }),
  );
}
export function Toasts() {
  const { toast } = useToast();
  useEffect(() => {
    const listener = (event: Event) => {
      const { message, error } = (
        event as CustomEvent<{ message: string; error: boolean }>
      ).detail;
      toast({ title: message, tone: error ? 'caution' : 'neutral' });
    };
    window.addEventListener('rehab-toast', listener);
    return () => window.removeEventListener('rehab-toast', listener);
  }, [toast]);
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
  return (
    <DSConfirmDialog
      open
      title={heading}
      description={children}
      confirmLabel="End session"
      cancelLabel="Keep practicing"
      onConfirm={onConfirm}
      onCancel={onCancel}
      size="lg"
    />
  );
}
export function BrowserSupportBanner() {
  return 'serial' in navigator ? null : (
    <Banner tone="info" title="Connect with Chrome or Edge">
      Use Chrome or Edge to connect the glove.{' '}
      <Link to="/setup">Use simulator</Link> to practice here.
    </Banner>
  );
}
/** Page unmount and browser departure always request a runtime stop. */
export function useSessionLeaveGuard(kind: 'exercise' | 'evaluation') {
  const runtime = useRuntime(),
    { client } = useGlove();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
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
      mounted.current = false;
      // StrictMode remounts effects synchronously; only stop after a true departure.
      queueMicrotask(() => {
        if (!mounted.current) void runtime[kind].stop();
      });
    };
  }, [runtime, client, kind]);
}
