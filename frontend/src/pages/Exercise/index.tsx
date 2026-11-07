import {
  Button,
  ButtonLink,
  Card,
  Stack,
  Inline,
  PageHeader,
  Checkbox,
  Input,
  Pill,
  Switch,
} from '../../design-system';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { useRuntime, useExerciseView } from '../../runtime';
import {
  DEFAULT_PLAN,
  PINCH_PLAN,
  DEFAULT_EXERCISE_SETTINGS,
  POSES,
  type PoseId,
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
  FingerBars,
  AttemptToast,
  SessionSummaryCard,
  ConfirmDialog,
  useSessionLeaveGuard,
} from '../../components/common';
import { useQuery } from '@tanstack/react-query';
import { createSummary, useHealth } from '../../api/client';
const Hand = memo(function Hand() {
  const runtime = useRuntime(),
    vision = useVision();
  const pose = useExerciseView((v) => v.pose);
  const [compact, setCompact] = useState(
    () => window.matchMedia?.('(max-width: 1280px)').matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1280px)');
    if (!media) return;
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
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
      if (
        finger === 'ring' ||
        finger === 'pinky' ||
        v.pose.closure[finger as FingerId] === null ||
        ['PAUSED', 'PRESENT', 'REST', 'RELEASE'].includes(v.phase)
      )
        return 'idle';
      return v.phase === 'HOLD' || v.phase === 'ASSIST_HOLD'
        ? 'reached'
        : v.assisting
          ? 'assist'
          : 'active';
    },
    [runtime],
  );
  return (
    <div role="img" aria-label={`Target pose: ${pose.name}`}>
      <VirtualHand
        target={pose.render}
        actual={actual}
        state={state}
        pose={pose.id}
        zoom={compact ? 60 : 85}
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
          <Switch
            label="Mic on"
            checked={voice.mode === 'live' && !voice.muted}
            disabled={voice.mode !== 'live'}
            onCheckedChange={(on) => voice.setMuted(!on)}
          />
          <details
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
function LiveDetails() {
  const view = useExerciseView();
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  return (
    <aside className="live-details">
      <PhaseRing
        phase={view.phase}
        elapsed={view.phaseElapsed}
        duration={view.phaseDuration}
        waiting={view.phase === 'PRESENT' && !seen}
      />
      <FingerBars
        pose={view.pose}
        activeMax={view.activeMax}
        assisting={view.assisting}
      />
      <div className="camera-pip">
        <CameraOverlay compact />
      </div>
      <CoachArea />
    </aside>
  );
}
function Summary({ onAgain }: { onAgain: () => void }) {
  const view = useExerciseView();
  const summary = useQuery({
    queryKey: ['patient-summary', view.sessionId],
    queryFn: () =>
      createSummary({ kind: 'session', session_id: view.sessionId! }),
    enabled: view.sessionId != null,
    retry: false,
  });
  return (
    <>
      <SessionSummaryCard summary={view.summary!} />
      {summary.isFetching ? (
        <p role="status">Preparing your recap…</p>
      ) : summary.data?.text ? (
        <p>{summary.data.text}</p>
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
    { store } = useGlove();
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
  const [plan, setPlan] = useState<ExercisePlanItem[]>(DEFAULT_PLAN),
    [settings, setSettings] = useState<ExerciseSettings>(
      DEFAULT_EXERCISE_SETTINGS,
    ),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [planning, setPlanning] = useState(false),
    [preset, setPreset] = useState('glides');
  const live = phase !== 'DONE';
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
        : null;
  useSessionLeaveGuard('exercise');
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
        <Summary onAgain={() => setPlanning(true)} />
      </Stack>
    );
  if (!live)
    return (
      <Stack as="section" gap={24}>
        <PageHeader title="Your practice" lead="Choose a comfortable pace." />
        <Inline>
          {[
            { id: 'glides', label: 'Tendon glides', plan: DEFAULT_PLAN },
            { id: 'pinch', label: 'Pinch practice', plan: PINCH_PLAN },
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
                setPreset(p.id);
                setPlan(p.plan);
              }}
            >
              {p.label}
            </Pill>
          ))}
        </Inline>
        <Card>
          <Stack gap={12}>
            {Object.values(POSES).map((p) => (
              <div key={p.id} className="plan-row">
                <Checkbox
                  label={p.name}
                  checked={plan.some((i) => i.pose === p.id)}
                  onChange={(e) => {
                    setPreset('custom');
                    setPlan(
                      e.target.checked
                        ? [...plan, { pose: p.id as PoseId, reps: 3 }]
                        : plan.filter((i) => i.pose !== p.id),
                    );
                  }}
                />
                <Input
                  label={`Repetitions for ${p.name}`}
                  hideLabel
                  type="number"
                  min={1}
                  max={10}
                  disabled={!plan.some((i) => i.pose === p.id)}
                  value={plan.find((i) => i.pose === p.id)?.reps ?? ''}
                  onChange={(e) => {
                    setPreset('custom');
                    setPlan(
                      plan.map((i) =>
                        i.pose === p.id
                          ? { ...i, reps: Number(e.target.value) }
                          : i,
                      ),
                    );
                  }}
                />
              </div>
            ))}
          </Stack>
        </Card>
        <Checkbox
          label="Observation only (no glove help)"
          checked={!settings.assist_enabled}
          onChange={(e) =>
            setSettings({ ...settings, assist_enabled: !e.target.checked })
          }
        />
        <details>
          <summary>Advanced settings</summary>
          {Object.entries(settings)
            .filter(([k]) => k !== 'assist_enabled')
            .map(([key, value]) => (
              <Input
                key={key}
                label={key.replaceAll('_', ' ')}
                type="number"
                min={key === 'tolerance' ? 0.01 : 0.1}
                max={key === 'assist_speed' || key === 'tolerance' ? 1 : 60}
                step={0.1}
                value={Number(value)}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: Number(e.target.value) })
                }
              />
            ))}
        </details>
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
          <Hand />
          <h1 className="instruction">{instruction}</h1>
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
              size="lg"
              variant="quiet"
              iconAfter="arrow-right"
              onClick={runtime.exercise.skip}
            >
              Skip pose
            </Button>
          </Inline>
          {hint && <p className="pose-hint">{hint}</p>}
          {(phase === 'REST' || phase === 'RELEASE') && (
            <p>
              Next: {next ? POSES[next].name.toLowerCase() : 'session recap'}
            </p>
          )}
        </div>
        <LiveDetails />
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
        </ConfirmDialog>
      )}
    </section>
  );
}
function AttemptResultToast() {
  const result = useExerciseView((v) => v.lastResult);
  return <AttemptToast result={result} />;
}
