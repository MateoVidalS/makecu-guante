import {
  Button,
  ButtonLink,
  Card,
  Stack,
  Inline,
  PageHeader,
  Pill,
  Switch,
  VisuallyHidden,
} from '../../design-system';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { useRuntime, useExerciseView, useSavingStatus } from '../../runtime';
import {
  DEFAULT_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  POSES,
} from '../../contracts/poses';
import type {
  ExercisePlanItem,
  ExerciseSettings,
} from '../../contracts/engine';
import { CoachPanel, useVoice } from '../../voice';
import { VirtualHand } from '../../hand3d/VirtualHand';
import { jointsFromClosure, type JointMap } from '../../hand3d/rig';
import { useVision, useVisionFrame } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import { useGlove } from '../../glove';
import type { FingerId, VisionFrame } from '../../contracts/vision';
import {
  BigButton,
  PhaseRing,
  ConfirmDialog,
  useSessionLeaveGuard,
} from '../../components/common';
import { AttemptFeedback } from '../../components/metrics';
import type { AttemptResult } from '../../contracts/engine';
import { liveFingerState } from './fingerState';
import { LiveFingerMeters } from './LiveFingerMeters';
import { GloveMotors } from './GloveMotors';
import { SessionRecap, useSessionAttempts } from './SessionRecap';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import './exercise.css';
import { CoachDecisions } from './CoachDecisions';
import type { Runtime } from '../../contracts/runtime';
import { useQuery } from '@tanstack/react-query';
import { createSummary, useHealth } from '../../api/client';
const Hand = memo(function Hand() {
  const runtime = useRuntime(),
    vision = useVision();
  const pose = useExerciseView((v) => v.pose);
  const container = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(42.5);
  useEffect(() => {
    if (!container.current) return;
    // The hand spans ~6 model units tall and ~4.4 wide; fit both in the panel.
    const resize = new ResizeObserver(([entry]) =>
      setZoom(
        Math.min(
          85,
          entry.contentRect.height / 6,
          entry.contentRect.width / 4.4,
        ),
      ),
    );
    resize.observe(container.current);
    return () => resize.disconnect();
  }, []);
  const actualJoints = useRef<JointMap | null>(null);
  useEffect(() => {
    vision.setCalibration(runtime.calibration.current?.camera ?? null);
    const update = (frame: VisionFrame | null) => {
      actualJoints.current =
        frame?.detected && frame.confidence >= 0.6
          ? (frame.joints ??
            (frame.closure
              ? jointsFromClosure(frame.closure, runtime.exercise.view().pose)
              : null))
          : null;
    };
    update(vision.source.latest());
    return vision.source.onFrame(update);
  }, [vision, vision.source, runtime]);
  const actual = useCallback(() => actualJoints.current, []);
  const state = useCallback(
    (finger: string) => {
      const v = runtime.exercise.view();
      return liveFingerState({
        phase: v.phase,
        target: v.pose.closure[finger as FingerId],
        value:
          vision.latest?.detected && vision.latest.confidence >= 0.6
            ? (vision.latest.closure?.[finger as FingerId] ?? null)
            : null,
        best: v.activeMax[finger as FingerId] ?? null,
        assisting: v.assisting,
      });
    },
    [runtime, vision],
  );
  return (
    <div
      ref={container}
      className="live-panel__body"
      role="img"
      aria-label={`Target pose: ${pose.name}`}
    >
      {/* TODO(U2): Pass therapy.state()?.highlighted_finger via highlight once VirtualHand exposes that prop. */}
      <VirtualHand
        target={pose.render}
        actual={actual}
        state={state}
        pose={pose.id}
        zoom={zoom}
        handedness={
          runtime.calibration.current?.camera.affected_hand ?? 'right'
        }
      />
    </div>
  );
});
const CoachArea = memo(function CoachArea() {
  const voice = useVoice();
  return (
    <>
      <div className="coach-compact">
        <p className="coach-caption">
          {voice.lastCoachLine ??
            (voice.mode === 'off' ? 'Voice off' : 'Your coach is here.')}
        </p>
        <div className="actions coach-quick-controls">
          {voice.mode === 'live' && (
            <Switch
              label="Microphone"
              checked={voice.mode === 'live' && !voice.muted}
              disabled={voice.mode !== 'live'}
              onCheckedChange={(on) => voice.setMuted(!on)}
            />
          )}
          <details
            data-safety-popover
            data-voice-mode={voice.mode}
            onToggle={(event) => {
              if (document.querySelector('#safety-banner-slot [role="alert"]'))
                event.currentTarget.open = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.open = false;
                e.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary>Coach controls</summary>
            <div className="coach-popover">
              <CoachPanel />
            </div>
          </details>
        </div>
      </div>
    </>
  );
});
const CAMERA_KEY = 'rehab-hub.exercise.camera';
function readCameraPreference() {
  try {
    return window.localStorage.getItem(CAMERA_KEY) === 'shown';
  } catch {
    return false;
  }
}
/** The virtual hand stays prominent next to an optional small camera panel: the virtual hand against its target, and what the camera sees. */
export function LiveStage() {
  const [camera, setCamera] = useState(readCameraPreference);
  const toggle = (on: boolean) => {
    setCamera(on);
    try {
      window.localStorage.setItem(CAMERA_KEY, on ? 'shown' : 'hidden');
    } catch {
      /* Preference is a convenience only. */
    }
  };
  return (
    <div className="live-stage" data-camera={camera ? 'shown' : 'hidden'}>
      <section className="live-panel" aria-label="Target and your hand">
        <header className="live-panel__head">
          <h2 className="live-panel__title">Target &amp; your hand</h2>
          {!camera && (
            <Switch
              className="live-camera-toggle"
              label="Show camera"
              checked={camera}
              onCheckedChange={toggle}
            />
          )}
        </header>
        <Hand />
      </section>
      {camera && (
        <section className="live-panel live-panel--camera" aria-label="Camera">
          <header className="live-panel__head">
            <h2 className="live-panel__title">Camera</h2>
            <Switch
              className="live-camera-toggle"
              label={<VisuallyHidden>Show camera</VisuallyHidden>}
              checked={camera}
              onCheckedChange={toggle}
            />
          </header>
          <div className="live-panel__body live-panel__body--camera">
            <CameraOverlay bare mirrored />
          </div>
        </section>
      )}
    </div>
  );
}
function LiveDetails() {
  const view = useExerciseView();
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  return (
    <aside className="live-details">
      <PhaseRing
        compact
        phase={view.phase}
        elapsed={view.phaseElapsed}
        duration={view.phaseDuration}
        waiting={view.phase === 'PRESENT' && !seen}
      />
      <LiveFingerMeters
        pose={view.pose}
        phase={view.phase}
        activeMax={view.activeMax}
        assisting={view.assisting}
      />
      <GloveMotors />
      <div className="live-tools">
        <CoachArea />
      </div>
    </aside>
  );
}
function Summary({
  onAgain,
  attempts,
}: {
  onAgain: () => void;
  attempts: AttemptResult[];
}) {
  const view = useExerciseView();
  const runtime = useRuntime();
  const saving = useSavingStatus();
  const summary = useQuery({
    queryKey: ['patient-summary', view.sessionId],
    queryFn: () =>
      createSummary({ kind: 'session', session_id: view.sessionId! }),
    enabled: view.sessionId != null && saving === 'Saved',
    retry: false,
  });
  return (
    <>
      <SessionRecap
        summary={view.summary!}
        attempts={attempts}
        mirrored={runtime.calibration.current?.camera.affected_hand === 'left'}
      />
      {summary.isFetching ? (
        <p role="status">Preparing your recap…</p>
      ) : summary.data?.text ? (
        <p className="recap__coach">{summary.data.text}</p>
      ) : saving !== 'Saved' ? (
        <p role="status">Your recap will be available after saving.</p>
      ) : summary.isError ? (
        <p role="status">Summary unavailable. Your session is saved.</p>
      ) : null}
      <div className="actions">
        <BigButton variant="primary" onClick={onAgain}>
          Practice again
        </BigButton>
        <ButtonLink to="/history">See progress</ButtonLink>
        <ButtonLink to="/">Home</ButtonLink>
      </div>
    </>
  );
}
export default function Exercise() {
  const runtime = useRuntime(),
    voice = useVoice(),
    location = useLocation(),
    { store, client: glove } = useGlove();
  const therapy = (runtime as Runtime).therapy;
  const brake = () => {
    if (therapy) therapy.brake('You pressed Brake.', 'patient_ui');
    else {
      glove.release();
      runtime.exercise.pause();
    }
  };
  const { start: startVoice, stop: stopVoice, setMode: setVoiceMode } = voice;
  const voiceMode = useRef(voice.mode);
  voiceMode.current = voice.mode;
  const health = useHealth();
  const voiceSessionId = useExerciseView((v) => v.sessionId);
  const phase = useExerciseView((v) => v.phase),
    pose = useExerciseView((v) => v.pose),
    paused = phase === 'PAUSED',
    summary = useExerciseView((v) => v.summary);
  const connected = useStore(store, (s) => s.connection === 'connected');
  const [short, setShort] = useShortPractice();
  const [plan, setPlan] = useState<ExercisePlanItem[]>(() =>
      practicePlan(short),
    ),
    [settings] = useState<ExerciseSettings>(DEFAULT_EXERCISE_SETTINGS),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [planning, setPlanning] = useState(
      () => new URLSearchParams(location.search).get('customize') === '1',
    ),
    [preset, setPreset] = useState(short ? 'short' : 'glides');
  const live = phase !== 'DONE';
  const attempts = useSessionAttempts();
  const index = useExerciseView((v) => v.index);
  const next = plan.flatMap((p) =>
    Array.from({ length: Math.min(10, Math.max(0, p.reps)) }, () => p.pose),
  )[index + 1];
  const instruction =
    pose.id === 'hook'
      ? 'Make a hook'
      : pose.id === 'tabletop'
        ? 'Make a tabletop'
        : pose.id === 'pinch'
          ? 'Touch thumb to index'
          : pose.instruction;
  const hint =
    pose.id === 'hook'
      ? 'Bend the top two joints'
      : pose.id === 'tabletop'
        ? 'Bend only at the knuckles'
        : 'Palm down, fingers beyond the table edge';
  useSessionLeaveGuard('exercise');
  useEffect(() => {
    const finish = () => setConfirm(true);
    window.addEventListener('rehab-finish-practice', finish);
    return () => window.removeEventListener('rehab-finish-practice', finish);
  }, []);
  useEffect(() => {
    if (!live) return;
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,select,textarea,button,summary,[contenteditable],dialog',
          ))
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        const v = runtime.exercise.view();
        if (v.paused) runtime.exercise.resume();
        else runtime.exercise.pause();
      } else if (e.key.toLowerCase() === 's') runtime.exercise.skip();
      else if (e.key === 'Escape') {
        e.preventDefault();
        setConfirm(true);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [live, runtime]);
  useEffect(() => {
    if (!live || health.isPending) return;
    if (health.data?.gemini === false && voiceMode.current === 'live')
      setVoiceMode('simple');
    void startVoice(voiceSessionId).catch((e) =>
      setError((e as Error).message),
    );
  }, [
    live,
    voiceSessionId,
    startVoice,
    setVoiceMode,
    health.isPending,
    health.data?.gemini,
  ]);
  useEffect(() => () => stopVoice(), [stopVoice]);
  async function start() {
    setBusy(true);
    setError('');
    try {
      await runtime.exercise.start(plan, settings);
      setPlanning(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!live && summary && !planning)
    return (
      <Stack as="section" gap={24}>
        <Summary onAgain={() => setPlanning(true)} attempts={attempts} />
      </Stack>
    );
  if (!live)
    return (
      <Stack as="section" gap={24} className="practice-plan">
        <PageHeader
          title="Your practice"
          lead="Choose a comfortable pace. Rest palm down, fingers beyond the table edge."
        />
        <Inline>
          {[
            { id: 'glides', label: 'Tendon glides', plan: DEFAULT_PLAN },
            {
              id: 'fist',
              label: 'Fist only, 1 rep',
              plan: [{ pose: 'full_fist' as const, reps: 1 }],
            },
            {
              id: 'short',
              label: 'Short session',
              plan: DEFAULT_PLAN.map((p) => ({ ...p, reps: 1 })),
            },
          ].map((p) => (
            <Pill
              key={p.id}
              selected={preset === p.id}
              onClick={() => {
                setShort(p.id === 'short');
                setPreset(p.id);
                setPlan(p.plan);
              }}
            >
              {p.label}
            </Pill>
          ))}
        </Inline>
        <Card title="Plan">
          <p>
            {plan
              .map((item) => `${POSES[item.pose].name} × ${item.reps}`)
              .join(' · ')}
          </p>
        </Card>
        {!runtime.calibration.current && (
          <p>
            Find your comfortable range first.{' '}
            <Link to="/calibrate">Calibrate</Link>
          </p>
        )}
        {!connected && settings.assist_enabled && (
          <Link to="/setup">Connect your glove</Link>
        )}
        {error && <p role="alert">{error}</p>}
        <Button
          size="lg"
          variant="primary"
          disabled={
            busy ||
            !runtime.calibration.current ||
            (settings.assist_enabled && !connected) ||
            !plan.length ||
            plan.some(
              (p) => !Number.isInteger(p.reps) || p.reps < 1 || p.reps > 10,
            ) ||
            Object.values(settings).some(
              (v) => typeof v === 'number' && (!Number.isFinite(v) || v <= 0),
            )
          }
          onClick={() => void start()}
        >
          Start practice
        </Button>
      </Stack>
    );
  return (
    <section
      className={`exercise-live ${paused ? 'practice-paused' : ''}`}
      key={location.key}
    >
      <div className="live-layout">
        <div className="live-hero">
          <div className="live-heading">
            <h1 className="instruction">{instruction}</h1>
            {hint && <p className="pose-hint">{hint}</p>}
            {(phase === 'REST' || phase === 'RELEASE') && (
              <p className="pose-next">
                Next: {next ? POSES[next].name.toLowerCase() : 'session recap'}
              </p>
            )}
          </div>
          <Inline justify="center" gap={12} className="practice-actions">
            <Button
              size="lg"
              icon={paused ? 'play' : 'pause'}
              variant={paused ? 'primary' : 'secondary'}
              onClick={() =>
                paused ? runtime.exercise.resume() : runtime.exercise.pause()
              }
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              className="therapy-brake"
              size="lg"
              variant="danger"
              onClick={brake}
            >
              Brake
            </Button>
            <Button
              size="lg"
              variant="quiet"
              iconAfter="arrow-right"
              onClick={runtime.exercise.skip}
            >
              Skip pose
            </Button>
          </Inline>
          {/* After the actions in DOM (tab order), above them on screen. */}
          <LiveStage />
        </div>
        <LiveDetails />
      </div>
      <CoachDecisions
        therapy={therapy}
        sessionId={voiceSessionId}
        onBrake={brake}
      />
      <AttemptResultToast />
      {confirm && (
        <ConfirmDialog
          title="Finish for today?"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void runtime.exercise.stop();
          }}
        >
          Your practice so far will be saved.
          <Button
            size="lg"
            variant="danger"
            onClick={() => {
              brake();
              setConfirm(false);
            }}
          >
            Brake
          </Button>
        </ConfirmDialog>
      )}
    </section>
  );
}
function AttemptResultToast() {
  const result = useExerciseView((v) => v.lastResult);
  const runtime = useRuntime();
  return (
    <AttemptFeedback
      result={result}
      mirrored={runtime.calibration.current?.camera.affected_hand === 'left'}
    />
  );
}
