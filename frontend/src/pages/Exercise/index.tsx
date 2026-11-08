import { BenchMirrorStatus } from '../../runtime/BenchMirrorStatus';
import {
  Button,
  ButtonLink,
  Card,
  Stack,
  Inline,
  PageHeader,
  Pill,
  Switch,
  Icon,
} from '../../design-system';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { useRuntime, useExerciseView, useSavingStatus } from '../../runtime';
import {
  DEFAULT_PLAN,
  TENDON_GLIDE_PLAN,
  FINGER_PLAN,
  OPEN_ASSIST_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  POSES,
  opensFinger,
} from '../../contracts/poses';
import { GLOVE_FINGERS } from '../../contracts/glove';
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
import { attemptStatus } from './attemptStatus';
import { SuccessTick } from './SuccessTick';
import { SessionRecap, useSessionAttempts } from './SessionRecap';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import './exercise.css';
import { CoachDecisions } from './CoachDecisions';
import { useProgressPlan } from '../../components/common/SessionProgress';
import { useSafetyBannerVisible } from '../../components/common/safetyPresence';
import { CalibrationIssueBanner } from '../../components/calibration';
import { useCalibrationStatus } from '../../runtime/calibrationValidation';
import type { Runtime } from '../../contracts/runtime';
import type { LiveTherapyState } from '../../contracts/therapist';
import { useHighlightedFinger } from '../../components/therapy/useHighlightedFinger';
import { useQuery } from '@tanstack/react-query';
import { createSummary, useHealth } from '../../api/client';
import { usePracticePreflightGate } from '../../components/common/preflight';
const Hand = memo(function Hand() {
  const runtime = useRuntime(),
    vision = useVision();
  const therapy = (runtime as Runtime).therapy;
  const highlighted = useHighlightedFinger(therapy);
  const phase = useExerciseView((v) => v.phase);
  const pose = useExerciseView((v) => v.pose);
  const therapyState = useRef<LiveTherapyState | null>(
    therapy?.state() ?? null,
  );
  useEffect(() => {
    // Shaping and patient-requested reach must share the meters' reached threshold.
    const update = () => {
      therapyState.current = therapy?.state() ?? null;
    };
    update();
    return therapy?.onDecision(update);
  }, [therapy, phase, pose]);
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
      const liveFinger =
        therapyState.current?.pose === v.pose.id
          ? therapyState.current.fingers.find((f) => f.finger === finger)
          : undefined;
      return liveFingerState({
        phase: v.phase,
        target: liveFinger
          ? liveFinger.target
          : v.pose.closure[finger as FingerId],
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
      <VirtualHand
        highlight={highlighted}
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
const CAMERA_KEY = 'rehab-hub.exercise.camera';
/** A saved choice wins; otherwise a real webcam is shown (what the app sees), the simulator is not. */
function readCameraPreference(realCamera: boolean) {
  try {
    const saved = window.localStorage.getItem(CAMERA_KEY);
    return saved ? saved === 'shown' : realCamera;
  } catch {
    return realCamera;
  }
}
/** The virtual hand stays prominent next to an optional small camera panel: the virtual hand against its target, and what the camera sees. */
export function LiveStage() {
  const realCamera = useVision().source.kind === 'camera';
  const [camera, setCamera] = useState(() => readCameraPreference(realCamera));
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
          <Switch
            className="live-camera-toggle"
            label="Show camera"
            checked={camera}
            onCheckedChange={toggle}
          />
        </header>
        <Hand />
      </section>
      {camera && (
        <section className="live-panel live-panel--camera" aria-label="Camera">
          <header className="live-panel__head">
            <h2 className="live-panel__title">Camera</h2>
          </header>
          <div className="live-panel__body live-panel__body--camera">
            <CameraOverlay bare mirrored />
          </div>
        </section>
      )}
    </div>
  );
}
function LiveDetails({ onBrake }: { onBrake: () => void }) {
  const runtime = useRuntime();
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
        status={attemptStatus(view.phase, view.lastResult, view.index)}
      />
      <LiveFingerMeters
        pose={view.pose}
        phase={view.phase}
        activeMax={view.activeMax}
        assisting={view.assisting}
      />
      <GloveMotors />
      <p className="hp-note live-direction-note">
        {view.pose.id === 'open'
          ? 'Try opening. The glove can help with the rest.'
          : 'Make the pose yourself. The glove only follows.'}
      </p>
      <div className="live-tools">
        <CoachPanel compact />
        <CoachDecisions
          therapy={(runtime as Runtime).therapy}
          sessionId={view.sessionId}
          onBrake={onBrake}
        />
        <BenchMirrorStatus />
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
  const { checkPreflight } = usePracticePreflightGate();
  const runtime = useRuntime(),
    voice = useVoice(),
    location = useLocation(),
    { store, client: glove } = useGlove();
  const therapy = (runtime as Runtime).therapy;
  const brake = () => {
    glove.release();
    runtime.exercise.pause();
    try {
      therapy?.brake('You pressed Brake.', 'patient_ui');
    } catch {
      // Audit failures must not prevent the patient from braking.
    }
    // The coach goes quiet, says "Stopped" locally and the model is told.
    voice.brake('You pressed Brake.');
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
    [preset, setPreset] = useState(short ? 'short' : 'opening');
  const safetyVisible = useSafetyBannerVisible();
  useProgressPlan(plan);
  const calibrationStatus = useCalibrationStatus();
  const live = phase !== 'DONE';
  const attempts = useSessionAttempts();
  const index = useExerciseView((v) => v.index);
  const lastResult = useExerciseView((v) => v.lastResult);
  const restLeft = useExerciseView((v) =>
    v.phase === 'REST' && v.phaseDuration != null
      ? Math.max(0, Math.ceil(v.phaseDuration - v.phaseElapsed))
      : 0,
  );
  const helpOffered = useExerciseView((v) => !!v.helpOffered);
  const status =
    phase === 'ATTEMPT' && helpOffered
      ? {
          title: 'Want the glove to help you open?',
          tone: 'assist' as const,
          done: false,
        }
      : attemptStatus(phase, lastResult, index);
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
        : 'Hand raised, palm to the screen, elbow resting';
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
  // Remember only our own automatic downgrade, so a helper's explicit "Simple voice" choice stays.
  const autoSimple = useRef(false);
  useEffect(() => {
    if (!live || health.isPending) return;
    if (health.data?.gemini === false && voiceMode.current === 'live') {
      autoSimple.current = true;
      setVoiceMode('simple');
    } else if (
      health.data?.gemini === true &&
      autoSimple.current &&
      voiceMode.current === 'simple'
    ) {
      // Gemini became available (e.g. the key was added after this tab loaded): go back to Live.
      autoSimple.current = false;
      setVoiceMode('live');
    }
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
    if (!checkPreflight()) return;
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
          lead="Choose a comfortable pace. Raise your hand beside your face, palm to the screen, elbow resting on the table."
        />
        <Inline>
          {[
            { id: 'opening', label: 'Opening practice', plan: DEFAULT_PLAN },
            { id: 'fingers', label: 'Finger by finger', plan: FINGER_PLAN },
            {
              id: 'open-close',
              label: 'Open and close',
              plan: OPEN_ASSIST_PLAN,
            },
            { id: 'glides', label: 'Tendon glides', plan: TENDON_GLIDE_PLAN },
            {
              id: 'open',
              label: 'Open only, 1 rep',
              plan: [{ pose: 'open' as const, reps: 1 }],
            },
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
        <CalibrationIssueBanner issue={calibrationStatus.issues[0]} />
        {calibrationStatus.state === 'missing' && (
          <p>
            Find your comfortable range first.{' '}
            <Link to="/calibrate">Calibrate</Link>
          </p>
        )}
        {!connected && settings.assist_enabled && (
          <Link to="/setup">Connect your glove</Link>
        )}
        {error && <p role="alert">{error}</p>}
        <Inline>
          <Button
            size="lg"
            variant="primary"
            disabled={
              busy ||
              calibrationStatus.state !== 'ok' ||
              (settings.assist_enabled && !connected) ||
              !plan.length ||
              plan.some(
                (p) => !Number.isInteger(p.reps) || p.reps < 1 || p.reps > 10,
              ) ||
              Object.values(settings).some(
                (v) => typeof v === 'number' && (!Number.isFinite(v) || v <= 0),
              )
            }
            aria-describedby={
              calibrationStatus.state !== 'ok' || !connected
                ? 'practice-start-hint'
                : undefined
            }
            onClick={() => void start()}
          >
            Start practice
          </Button>
          {(calibrationStatus.state !== 'ok' || !connected) && (
            <p id="practice-start-hint" className="muted">
              {calibrationStatus.issues[0]?.message ??
                (calibrationStatus.state === 'missing'
                  ? 'Calibrate your comfortable range first.'
                  : 'Connect your glove in Setup first.')}
            </p>
          )}
        </Inline>
      </Stack>
    );
  return (
    <section
      className={`exercise-live ${paused ? 'practice-paused' : ''}`}
      data-phase={phase}
      key={location.key}
    >
      <div className="live-layout">
        <div className="live-hero">
          <SuccessTick phase={phase} index={index} result={lastResult} />
          <div className="live-heading">
            <h1
              className={`instruction${status ? ` instruction--${status.tone}` : ''}`}
            >
              {status ? (
                <>
                  {status.done && <Icon name="check" />} {status.title}
                </>
              ) : (
                instruction
              )}
            </h1>
            {status && phase !== 'REST' ? (
              <p className="pose-hint">{instruction}</p>
            ) : (
              !status && hint && <p className="pose-hint">{hint}</p>
            )}
            {(phase === 'REST' || phase === 'RELEASE') && (
              <p className="pose-next">
                Next: {next ? POSES[next].name.toLowerCase() : 'session recap'}
                {phase === 'REST' && restLeft > 0 && ` · in ${restLeft} s`}
              </p>
            )}
          </div>
          <Inline justify="center" gap={12} className="practice-actions">
            {phase === 'ATTEMPT' &&
              GLOVE_FINGERS.some((f) => opensFinger(pose, f)) && (
                // The glove moves only when the patient asks: this button or saying "help".
                <Button
                  size="lg"
                  variant={helpOffered ? 'primary' : 'secondary'}
                  disabled={safetyVisible}
                  onClick={runtime.exercise.requestHelp}
                >
                  Help me open
                </Button>
              )}
            <Button
              size="lg"
              disabled={safetyVisible}
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
              disabled={safetyVisible}
              onClick={runtime.exercise.skip}
            >
              Skip pose
            </Button>
          </Inline>
          {/* After the actions in DOM (tab order), above them on screen. */}
          <LiveStage />
        </div>
        <LiveDetails onBrake={brake} />
      </div>
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
