import { useEffect, useRef, useState } from 'react';
import {
  Button,
  ButtonLink,
  PageHeader,
  Select,
  Input,
  Slider,
  Checkbox,
  ProgressRing,
  StatusChip,
  Badge,
  Banner,
  Icon,
  Meter,
  Card,
} from '../../design-system';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { useRuntime } from '../../runtime';

import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision, useVisionFrame } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import { CalibrationOpening } from './closure';
import { GLOVE_FINGERS } from '../../contracts/glove';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  CURRENT_ASSIST_DIRECTION,
  type ServoCalibration,
} from '../../contracts/calibration';
import type { VisionFrame } from '../../contracts/vision';
import { Section, Stepper, title } from '../../components/common';
import { PoseIllustration } from './PoseIllustration';
import { RangeBar } from './RangeBar';
import './calibrate.css';
import {
  fingers,
  resumableDraft,
  draftFromCalibration,
  saveDraft,
  freshDraft,
  stableCapture,
  validRange,
  type Draft,
} from './draft';
import {
  CalibrationIssueBanner,
  RelaxedHandSafetyStrip,
} from '../../components/calibration';
import {
  useCalibrationStatus,
  useSavedCalibration,
  selectCalibrationStatus,
  calibrationReadiness,
} from '../../runtime/calibrationValidation';

import { SimulatorCalibrationShortcut } from './SimulatorCalibrationShortcut';
import { usePracticePreflightGate } from '../../components/common/preflight';

export default function Calibrate() {
  const { checkPreflight } = usePracticePreflightGate();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkedStep = params.get('step');
  const linkedFinger = params.get('finger');
  const calibration = useSavedCalibration();
  const calibrationStatus = useCalibrationStatus();
  const readiness = calibrationReadiness(calibrationStatus);
  const hydrated = useRef(!!calibration);
  const edited = useRef(false);
  const [short] = useShortPractice();
  const runtime = useRuntime(),
    { client } = useGlove(),
    vision = useVision();
  const [draft, setDraft] = useState(() => resumableDraft(calibration)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(false),
    [captureKind, setCaptureKind] = useState<'open' | 'closed' | 'pinch'>(
      'closed',
    ),
    [progress, setProgress] = useState(0),
    [saved, setSaved] = useState(false);
  const seen = useVisionFrame(
    (frame) => !!frame?.detected && frame.confidence >= 0.6,
  );
  const mirror = draft.mirror;
  const current = useGloveTelemetry((t) => t?.ma ?? 0);
  const awaitingRanges = useRef(false);
  const cancel = useRef<() => void>(() => {}),
    mounted = useRef(true);
  const finger = GLOVE_FINGERS[draft.finger],
    range = draft.servo[finger];
  function update(patch: Partial<Draft>) {
    edited.current = true;
    setDraft((d) => ({ ...d, ...patch, edited: true }));
    setError('');
  }
  // Backend reload can finish after mount. Never overwrite edits already underway.
  useEffect(() => {
    if (!hydrated.current && calibration && !edited.current) {
      hydrated.current = true;
      const initial = resumableDraft(calibration);
      setDraft({
        ...initial,
        step:
          linkedStep === 'glove'
            ? 0
            : linkedStep === 'camera'
              ? 1
              : initial.step,
        finger:
          linkedFinger && GLOVE_FINGERS.includes(linkedFinger as typeof finger)
            ? GLOVE_FINGERS.indexOf(linkedFinger as typeof finger)
            : initial.finger,
      });
    }
  }, [calibration, linkedStep, linkedFinger]);
  useEffect(() => {
    if (linkedStep !== 'glove' && linkedStep !== 'camera') return;
    cancel.current();
    client.release();
    setDraft((current) => ({
      ...current,
      step: linkedStep === 'glove' ? 0 : 1,
      finger:
        linkedFinger && GLOVE_FINGERS.includes(linkedFinger as typeof finger)
          ? GLOVE_FINGERS.indexOf(linkedFinger as typeof finger)
          : current.finger,
    }));
  }, [linkedStep, linkedFinger, client]);
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);
  useEffect(() => {
    if (draft.step === 1) {
      void vision.start({ affectedHand: draft.hand }).catch((e) => {
        const message = (e as Error).message;
        setError(
          /permission|notallowed/i.test(`${(e as Error).name} ${message}`)
            ? 'Camera access is blocked. Allow the camera in the browser’s address bar, then reload the page.'
            : message,
        );
      });
    }
  }, [draft.step, draft.hand, vision]);
  useEffect(() => {
    mounted.current = true;
    const unsub = client.onEvent((e) => {
      if (e.e === 'calib_ok' && awaitingRanges.current) {
        awaitingRanges.current = false;
        setDraft((d) => (d.step === 0 ? { ...d, step: 1 } : d));
      }
      if (
        ['overcurrent', 'stop_button', 'watchdog', 'ina_missing'].includes(e.e)
      ) {
        client.release();
        cancel.current();
        const reason =
          e.e === 'overcurrent'
            ? `Current limit reached (${e.ma != null ? Math.round(e.ma) + ' mA' : 'overcurrent'}).`
            : e.e === 'stop_button'
              ? 'STOP button pressed.'
              : e.e === 'watchdog'
                ? 'Glove watchdog: connection timed out.'
                : 'Current sensor unavailable.';
        setError(`Glove stopped. ${reason} Check the glove before continuing.`);
      }
    });
    const errors = client.onError((e) => {
      // STOP can reject release; retrying that same error would loop indefinitely.
      if (e.c !== 'release') client.release();
      cancel.current();
      setError(
        e.c === 'release' && e.why === 'fault'
          ? 'The glove remains stopped. Release STOP before continuing.'
          : `Glove: ${e.why.replaceAll('_', ' ')}`,
      );
    });
    const connection = client.onConnection((c) => {
      if (c !== 'connected') {
        client.release();
        cancel.current();
        setError('Reconnect the glove before continuing.');
      }
    });
    const unload = () => {
      cancel.current();
      client.release();
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      mounted.current = false;
      cancel.current();
      unsub();
      errors();
      connection();
      window.removeEventListener('beforeunload', unload);
      client.release();
      void runtime.evaluation.stop();
      client.limit(runtime.calibration.current?.current_limit_ma ?? 1500);
    };
  }, [client, runtime]);
  async function action(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function jog(angle: number) {
    if (client.connection() !== 'connected') {
      setError('Connect the glove first.');
      return;
    }
    client.limit(400);
    const bounded = Math.max(5, Math.min(175, angle));
    client.jog(draft.finger as 0 | 1 | 2 | 3 | 4, bounded);
    update({ angle: bounded });
  }
  function setRange(key: 'min_deg' | 'max_deg') {
    update({
      friction: {},
      servo: {
        ...draft.servo,
        [finger]: { ...range, finger, [key]: draft.angle },
      },
    });
  }
  async function sendRanges() {
    if (!GLOVE_FINGERS.every((f) => validRange(draft.servo[f])))
      throw new Error(
        'Set comfortable slack and open angles for every finger.',
      );
    if (client.connection() !== 'connected')
      throw new Error('Connect the glove first.');
    client.release();
    awaitingRanges.current = true;
    GLOVE_FINGERS.forEach((f, i) => {
      const r = draft.servo[f]!;
      client.calib(i as 0 | 1 | 2 | 3 | 4, r.min_deg!, r.max_deg!);
    });
  }
  function captureRange(kind: 'open' | 'closed' | 'pinch') {
    if (client.connection() !== 'connected') {
      setError('Connect the glove first.');
      return;
    }
    if (!vision.latest?.detected || vision.latest.confidence < 0.6) {
      setError('Keep your hand in the camera frame before capturing.');
      return;
    }
    setError('');
    setCaptureKind(kind);
    setCapture(true);
    setProgress(0);
    const frames: VisionFrame[] = [];
    const started = performance.now();
    // Closed is always an active fist. A simulated glove cannot open a real hand.
    const gloveOpens = kind === 'open' && !ownFist;
    client.release();
    let holdStarted: number | null = gloveOpens ? null : started;
    let lastFrameAt = started;
    const telemetry = client.latest();
    if (gloveOpens && !telemetry) {
      setCapture(false);
      setError('Wait for glove readings, then try again.');
      return;
    }
    const opening = gloveOpens ? new CalibrationOpening(telemetry!.a) : null;
    if (opening) client.limit(Math.min(1500, draft.limit));
    let resistanceSince: number | null = null;
    let previousRaw = vision.latest?.rawFlexSum ?? null;
    let resistanceCheckAt = started;
    const unsubscribe = vision.source.onFrame((frame) => {
      lastFrameAt = performance.now();
      if (!frame.detected || frame.confidence < 0.6) {
        cancel.current();
        setError('Keep your hand in view. Try again.');
        return;
      }
      if (holdStarted === null) return;
      frames.push(frame);
      setProgress(Math.min(100, (performance.now() - holdStarted) / 20));
    });
    const cleanup = () => {
      cancel.current = () => {};
      clearInterval(timer);
      unsubscribe();
      client.release();
      if (mounted.current) setCapture(false);
    };
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - lastFrameAt > 500) {
        cleanup();
        setError(
          'Camera readings stopped. Reconnect the camera and try again.',
        );
        return;
      }
      const reading = client.latest();
      if (opening && reading?.st === 'fault') {
        cleanup();
        setError('Glove stopped. Check the glove before continuing.');
        return;
      }
      // Stop a loaded stretch that is no longer opening the fingers.
      if (opening && reading && now - resistanceCheckAt >= 300) {
        const raw = vision.latest?.rawFlexSum;
        const stalled =
          raw &&
          previousRaw &&
          GLOVE_FINGERS.some(
            (f, i) =>
              opening.target[i] > 0 &&
              reading.a[i] > 0.1 &&
              previousRaw![f] - raw[f] < 2,
          );
        if (stalled && reading.ma >= Math.min(1500, draft.limit) * 0.8) {
          resistanceSince ??= now;
          if (now - resistanceSince >= 300) {
            cleanup();
            setError('Resistance while opening. Check the fit and try again.');
            return;
          }
        } else resistanceSince = null;
        previousRaw = raw ?? null;
        resistanceCheckAt = now;
      }
      const position = reading?.a;
      if (opening && holdStarted === null && position) {
        if (opening.advance(now, position))
          client.target([...opening.target], 0.3);
        if (opening.settled(position)) holdStarted = now;
      }
      if (holdStarted === null) {
        if (now - started > 20_000) {
          cleanup();
          setError('The glove could not settle. Check the fit and try again.');
        }
        return;
      }
      if (now - holdStarted < 2100) return;
      cleanup();
      try {
        const value = stableCapture(frames);
        if (frames.some((f) => f.handedness !== draft.hand))
          throw new Error('Show the selected hand and try again.');
        if (
          kind === 'open' &&
          draft.closed &&
          GLOVE_FINGERS.some((f) => draft.closed!.raw[f] - value.raw[f] < 20)
        )
          throw new Error('Move further from your fist position. Try again.');
        if (kind === 'pinch' && draft.open && value.pinch >= draft.open.pinch)
          throw new Error('Touch your thumb and index finger. Try again.');
        update(
          kind === 'closed' ? { closed: value, open: null } : { [kind]: value },
        );
      } catch (e) {
        setError((e as Error).message);
      }
    }, 50);
    cancel.current = cleanup;
  }

  async function save() {
    if (
      !draft.open ||
      !draft.closed ||
      !GLOVE_FINGERS.every((f) => validRange(draft.servo[f])) ||
      !Number.isFinite(draft.limit) ||
      draft.limit < 100 ||
      draft.limit > 2200
    )
      throw new Error('Complete each calibration step before saving.');
    const camera = {
      affected_hand: draft.hand,
      camera_view: CURRENT_CAMERA_VIEW,
      flex_model: CURRENT_FLEX_MODEL,
      open_flex: draft.open.raw,
      closed_flex: draft.closed.raw,
      pinch_open: draft.open.pinch,
      // Pinch practice is postponed; retain a valid contract value without another capture.
      pinch_closed: Math.min(draft.closed.pinch, draft.open.pinch * 0.5),
    };
    await runtime.calibration.save({
      assist_direction: CURRENT_ASSIST_DIRECTION,
      servo: GLOVE_FINGERS.map((f) => draft.servo[f] as ServoCalibration),
      camera,
      friction: draft.friction,
      current_limit_ma: draft.limit,
    });
    await runtime.calibration.sendToGlove();
    vision.setCalibration(camera);
    saveDraft(freshDraft());
    setSaved(true);
  }
  const draftStatus = selectCalibrationStatus(
    {
      assist_direction: draft.assistDirection,
      servo: GLOVE_FINGERS.map(
        (f) => draft.servo[f] as ServoCalibration,
      ).filter(Boolean),
      camera: {
        affected_hand: draft.hand,
        camera_view: draft.cameraView,
        flex_model: draft.flexModel,
        open_flex: draft.open?.raw ?? {
          thumb: 0,
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
        },
        closed_flex: draft.closed?.raw ?? {
          thumb: 0,
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
        },
        pinch_open: draft.open?.pinch ?? 1,
        pinch_closed: draft.closed?.pinch ?? 0,
      },
    },
    vision.source.kind === 'sim',
    vision.latest,
  );
  const allRangesSet = GLOVE_FINGERS.every((f) => validRange(draft.servo[f]));
  const simulated = client.kind === 'sim' && vision.source.kind === 'sim';
  /** Simulated glove with the real camera: no servos to range, the patient closes their own hand. */
  const ownFist = client.kind === 'sim' && vision.source.kind === 'camera';
  function applySimulatedRanges() {
    update({
      friction: {},
      servo: Object.fromEntries(
        GLOVE_FINGERS.map((f) => [f, { finger: f, min_deg: 20, max_deg: 150 }]),
      ) as typeof draft.servo,
      finger: GLOVE_FINGERS.length - 1,
    });
    void action(async () => {
      client.release();
      GLOVE_FINGERS.forEach((_, i) =>
        client.calib(i as 0 | 1 | 2 | 3 | 4, 20, 150),
      );
      update({ step: 1 });
    });
  }
  if (saved)
    return (
      <div className="hp-page">
        <PageHeader
          title="Your range is saved"
          lead="The glove has your calibration. You can start practice."
        />
        <div className="hp-actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (!checkPreflight()) return;
                await runtime.exercise.start(
                  practicePlan(short),
                  DEFAULT_EXERCISE_SETTINGS,
                );
                navigate('/exercise');
              })
            }
          >
            Start practice
          </Button>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    );
  const back = (step: number) => (
    <Button
      variant="quiet"
      disabled={busy || capture}
      onClick={() => {
        client.release();
        update({ step });
      }}
    >
      Back
    </Button>
  );
  const cameraDone = !!draft.open && !!draft.closed;
  const task =
    range?.min_deg == null ? 'slack' : range?.max_deg == null ? 'open' : 'done';
  const bothSet = range?.min_deg != null && range?.max_deg != null;
  const apart = bothSet ? Math.abs(range!.max_deg! - range!.min_deg!) : 0;
  const issueFor = (f: string, step: 'glove' | 'camera') =>
    draftStatus.issues.find((i) => i.finger === f && i.step === step);
  const flexMax = Math.max(
    1,
    ...fingers.flatMap((f) => [
      draft.open?.raw[f] ?? 0,
      draft.closed?.raw[f] ?? 0,
    ]),
  );
  const captureStatus = (kind: 'open' | 'closed') =>
    capture &&
    captureKind === kind && (
      <div role="status" className="cal-capture">
        <ProgressRing
          value={progress / 100}
          label="Hold still"
          size={40}
          thickness={5}
        />
        <span className="cal-capture__text">
          {progress === 0
            ? kind === 'open' && !ownFist
              ? 'The glove is opening your hand…'
              : 'Get into position…'
            : 'Hold still…'}
        </span>
        <Button size="sm" variant="quiet" onClick={() => cancel.current()}>
          Cancel capture and release
        </Button>
      </div>
    );
  return (
    <div className="hp-page">
      <PageHeader
        title="Find your comfortable range"
        lead="Three short steps, about three minutes. Your progress is kept if you leave this page."
      />
      {simulated && (
        <Section className="hp-plain cal-sim-top">
          <SimulatorCalibrationShortcut
            onSaved={(value) => {
              edited.current = false;
              hydrated.current = true;
              setDraft(draftFromCalibration(value));
            }}
          />
        </Section>
      )}
      <div className="hp-wizard cal-wizard">
        <div className="cal-head">
          <Stepper
            labels={['Glove range', 'Camera range', 'Review']}
            step={draft.step}
            completed={[allRangesSet, cameraDone, false]}
            disabled={busy || capture}
            onStep={(step) => {
              cancel.current();
              client.release();
              update({ step });
            }}
          />
          <StatusChip
            label="Calibration"
            value={readiness.value}
            tone={readiness.tone}
          />
        </div>
        <CalibrationIssueBanner issue={calibrationStatus.issues[0]} />
        <RelaxedHandSafetyStrip
          release={() => {
            cancel.current();
            client.release();
            void runtime.evaluation.stop();
          }}
        />
        {error && (
          <p role="alert" className="hp-alert">
            {error}
          </p>
        )}
        {draft.step === 0 && (
          <Section
            flush
            title={`Step 1 · Glove range: ${title(finger)}`}
            description="For each finger, set two motor positions: slack with a relaxed fist, and open with the finger straight."
          >
            {ownFist && (
              <div className="cal-sim-card">
                <div>
                  <p className="cal-strong">
                    The glove is simulated, so there are no motors to range.
                  </p>
                  <p className="hp-note">
                    Use standard ranges and go straight to the camera step.
                  </p>
                </div>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={applySimulatedRanges}
                >
                  Use simulated glove ranges
                </Button>
              </div>
            )}
            <div
              className="cal-fingers"
              role="group"
              aria-label="Finger to calibrate"
            >
              {GLOVE_FINGERS.map((f, i) => {
                const r = draft.servo[f];
                const done = validRange(r);
                const status = done
                  ? 'Set'
                  : i === draft.finger
                    ? 'Editing'
                    : 'Not set';
                return (
                  <button
                    type="button"
                    key={f}
                    className={`cal-finger${i === draft.finger ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                    aria-label={`${title(f)} · ${status}`}
                    aria-current={i === draft.finger ? 'step' : undefined}
                    disabled={busy}
                    onClick={() => {
                      client.release();
                      update({ finger: i, angle: r?.min_deg ?? 90 });
                    }}
                  >
                    <span
                      className="cal-dot"
                      style={{ background: `var(--finger-${f})` }}
                    />
                    <span className="cal-finger__name">{title(f)}</span>
                    <span className="cal-finger__status">
                      {done ? (
                        <>
                          <Icon name="check" size={14} /> {r!.min_deg}°–
                          {r!.max_deg}°
                        </>
                      ) : (
                        status
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="cal-grid">
              <div className="cal-main">
                <Card padding="md" className="cal-motor">
                  <p className="cal-strong">Move the {finger} motor</p>
                  <Slider
                    label="Servo angle"
                    hint="Move gently. Find a comfortable range without pain."
                    min={5}
                    max={175}
                    value={draft.angle}
                    onValueChange={jog}
                    format={(v) => `${v}°`}
                  />
                  <div className="hp-actions" aria-label="Fine adjustment">
                    {[-5, -1, 1, 5].map((n) => (
                      <Button
                        key={n}
                        size="sm"
                        onClick={() => jog(draft.angle + n)}
                      >
                        {n > 0 ? '+' : '−'}
                        {Math.abs(n)}°
                      </Button>
                    ))}
                  </div>
                  <RangeBar
                    min={5}
                    max={175}
                    from={range?.min_deg}
                    to={range?.max_deg}
                    current={draft.angle}
                    tone={bothSet && !validRange(range) ? 'caution' : 'active'}
                  />
                </Card>
                <ol
                  className="cal-tasks"
                  aria-label={`${title(finger)} positions`}
                >
                  <li
                    className={`cal-task${task === 'slack' ? ' is-active' : ''}${range?.min_deg != null ? ' is-done' : ''}`}
                  >
                    <span className="cal-task__num" aria-hidden="true">
                      {range?.min_deg != null ? (
                        <Icon name="check" size={16} />
                      ) : (
                        1
                      )}
                    </span>
                    <PoseIllustration pose="slack" />
                    <div className="cal-task__body">
                      <p className="cal-strong">Slack</p>
                      <p>
                        Make a relaxed full fist. Jog until the thread is just
                        taut.
                      </p>
                      <p className="cal-task__value">
                        {range?.min_deg != null
                          ? `Slack at ${range.min_deg}°`
                          : 'Slack not set'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={task === 'slack' ? 'primary' : 'secondary'}
                      onClick={() => setRange('min_deg')}
                    >
                      Set slack
                    </Button>
                  </li>
                  <li
                    className={`cal-task${task === 'open' ? ' is-active' : ''}${range?.max_deg != null ? ' is-done' : ''}`}
                  >
                    <span className="cal-task__num" aria-hidden="true">
                      {range?.max_deg != null ? (
                        <Icon name="check" size={16} />
                      ) : (
                        2
                      )}
                    </span>
                    <PoseIllustration pose="open" />
                    <div className="cal-task__body">
                      <p className="cal-strong">Open</p>
                      <p>Jog until the finger is straight.</p>
                      <p id="hyperextension-warning" className="cal-caution">
                        <Icon name="caution" size={16} />
                        <span>
                          Hyperextension warning: stop at straight. Never bend
                          the finger back.
                        </span>
                      </p>
                      <p className="cal-task__value">
                        {range?.max_deg != null
                          ? `Open at ${range.max_deg}°`
                          : 'Open not set'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={task === 'open' ? 'primary' : 'secondary'}
                      aria-describedby="hyperextension-warning"
                      onClick={() => setRange('max_deg')}
                    >
                      Set open
                    </Button>
                  </li>
                </ol>
                {bothSet && !validRange(range) && (
                  <p role="alert" className="hp-alert">
                    Slack and open are only {apart}° apart. They must differ by
                    at least 20°.
                  </p>
                )}
              </div>
              <aside className="cal-aside" aria-label="Glove status">
                <Card tone="inset" padding="sm">
                  <Meter
                    label="Motor current"
                    value={current}
                    max={600}
                    limit={400}
                    valueText={`${Math.round(current)} mA`}
                    tone={
                      current > 400
                        ? 'danger'
                        : current > 300
                          ? 'assist'
                          : 'accent'
                    }
                  />
                  <p className="hp-note">
                    Limit while adjusting: 400 mA. The glove stops above it.
                  </p>
                  {current > 400 && (
                    <p role="alert" className="hp-alert">
                      Resistance is rising. Release the glove and check the fit.
                    </p>
                  )}
                </Card>
                <p className="cal-note">
                  <Icon name="info" size={16} />
                  <span>
                    First check the range on a mannequin or helper hand. Adjust
                    one finger at a time.
                  </span>
                </p>
                <details className="hp-disclosure">
                  <summary>Helper notes: power</summary>
                  <p className="hp-note">
                    Five servos share a 5 V, 2.5 A supply. The normal limit is
                    1500 mA; never exceed 2200 mA.
                    {client.kind !== 'sim' &&
                      ' After sending, wait for the glove to confirm its ranges.'}
                  </p>
                </details>
              </aside>
            </div>
            {(!validRange(range) || !allRangesSet) && (
              <p id="next-finger-hint" className="hp-note">
                {!validRange(range)
                  ? 'Set slack and open first, at least 20° apart.'
                  : 'Set slack and open for every finger before continuing.'}
              </p>
            )}
            <div className="hp-wizard__footer">
              <ButtonLink variant="quiet" to="/setup">
                Back
              </ButtonLink>
              <div className="hp-actions">
                <Button
                  variant="primary"
                  aria-describedby={
                    !validRange(range) || !allRangesSet
                      ? 'next-finger-hint'
                      : undefined
                  }
                  disabled={
                    busy ||
                    !validRange(range) ||
                    (draft.finger === GLOVE_FINGERS.length - 1 && !allRangesSet)
                  }
                  onClick={() => {
                    if (draft.finger === GLOVE_FINGERS.length - 1)
                      void action(sendRanges);
                    else {
                      client.release();
                      const next = GLOVE_FINGERS[draft.finger + 1];
                      update({
                        finger: draft.finger + 1,
                        angle: draft.servo[next]?.min_deg ?? 90,
                      });
                    }
                  }}
                >
                  {draft.finger === GLOVE_FINGERS.length - 1
                    ? 'Continue to camera range'
                    : 'Next finger'}
                </Button>
              </div>
            </div>
          </Section>
        )}
        {draft.step === 1 && (
          <Section
            flush
            title={`Step 2 · Camera range${linkedStep === 'camera' && linkedFinger ? `: ${title(finger)}` : ''}`}
            description="Raise your hand, palm to the screen, with your elbow supported. Keep still for two seconds during each capture."
          >
            <div className="cal-grid cal-grid--camera">
              <div className="cal-main">
                <div className="cal-camera-bar">
                  <Select
                    label="Affected hand"
                    value={draft.hand}
                    disabled={capture}
                    onChange={(e) =>
                      update({
                        hand: e.target.value as 'left' | 'right',
                        open: null,
                        closed: null,
                        pinch: null,
                      })
                    }
                  >
                    <option value="right">Right</option>
                    <option value="left">Left</option>
                  </Select>
                  <Checkbox
                    label="Mirror preview"
                    checked={mirror}
                    onChange={(e) => update({ mirror: e.target.checked })}
                  />
                  <Badge
                    tone={seen ? 'reached' : 'caution'}
                    icon={seen ? 'check' : 'caution'}
                  >
                    {seen ? 'Hand in view' : 'Show your hand to the camera'}
                  </Badge>
                </div>
                <div className="hp-camera">
                  <CameraOverlay mirrored={mirror} />
                </div>
              </div>
              <ol className="cal-tasks cal-aside" aria-label="Camera captures">
                <li
                  className={`cal-task cal-task--stack${!draft.closed ? ' is-active' : ' is-done'}`}
                >
                  <span className="cal-task__num" aria-hidden="true">
                    {draft.closed ? <Icon name="check" size={16} /> : 1}
                  </span>
                  <PoseIllustration pose="fist" size="sm" />
                  <div className="cal-task__body">
                    <p className="cal-strong">Your fist</p>
                    <p>Make your own fist and hold it still.</p>
                    <p className="cal-task__value">
                      {draft.closed ? 'Captured' : 'Not captured'}
                    </p>
                    {captureStatus('closed')}
                  </div>
                  <Button
                    size="sm"
                    variant={!draft.closed ? 'primary' : 'secondary'}
                    disabled={capture || !seen}
                    onClick={() => captureRange('closed')}
                  >
                    Capture my fist
                  </Button>
                </li>
                <li
                  className={`cal-task cal-task--stack${draft.closed && !draft.open ? ' is-active' : ''}${draft.open ? ' is-done' : ''}`}
                >
                  <span className="cal-task__num" aria-hidden="true">
                    {draft.open ? <Icon name="check" size={16} /> : 2}
                  </span>
                  <PoseIllustration pose="open-hand" size="sm" />
                  <div className="cal-task__body">
                    <p className="cal-strong">Open hand</p>
                    <p>
                      {ownFist
                        ? 'Open your own hand, fingers straight. Hold it still.'
                        : 'Relax. The glove opens all five fingers in stages.'}
                    </p>
                    <p className="cal-task__value">
                      {draft.open
                        ? 'Captured'
                        : draft.closed
                          ? 'Not captured'
                          : 'Capture your fist first'}
                    </p>
                    {captureStatus('open')}
                  </div>
                  <Button
                    size="sm"
                    variant={
                      draft.closed && !draft.open ? 'primary' : 'secondary'
                    }
                    disabled={capture || !draft.closed || !seen}
                    onClick={() => captureRange('open')}
                  >
                    {ownFist ? 'Capture open hand' : 'Glove opens the hand'}
                  </Button>
                </li>
              </ol>
            </div>
            <div className="hp-wizard__footer">
              {back(0)}
              <Button
                variant="primary"
                disabled={capture || !draft.open || !draft.closed}
                onClick={() => {
                  client.release();
                  update({ step: 2 });
                }}
              >
                Continue to review
              </Button>
            </div>
          </Section>
        )}
        {draft.step === 2 && (
          <Section
            flush
            title="Review your range"
            description="Check the values, then save. Saving also sends them to the glove."
          >
            <Banner
              tone={draftStatus.state === 'ok' ? 'info' : 'warning'}
              icon={draftStatus.state === 'ok' ? 'check' : 'caution'}
              title={
                draftStatus.state === 'ok'
                  ? 'All five glove ranges and both camera captures are ready.'
                  : 'Check the flagged ranges before saving.'
              }
            />
            <div className="cal-review">
              <Card
                title="Glove ranges"
                titleLevel={3}
                actions={
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => update({ step: 0 })}
                  >
                    Redo glove ranges
                  </Button>
                }
              >
                <ul className="cal-review__list">
                  {GLOVE_FINGERS.map((f) => {
                    const r = draft.servo[f];
                    const issue = issueFor(f, 'glove');
                    return (
                      <li key={f} className="cal-review__row">
                        <span
                          className="cal-dot"
                          style={{ background: `var(--finger-${f})` }}
                        />
                        <span className="cal-review__name">{title(f)}</span>
                        <RangeBar
                          compact
                          min={5}
                          max={175}
                          from={r?.min_deg}
                          to={r?.max_deg}
                          tone={issue ? 'caution' : 'reached'}
                        />
                        <span className="cal-review__val">
                          {r?.min_deg ?? '–'}° → {r?.max_deg ?? '–'}°
                        </span>
                        <span
                          className={
                            issue ? 'cal-review__issue' : 'cal-review__ok'
                          }
                        >
                          {issue?.message ?? 'Ready'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Card
                title={`Camera range · ${draft.hand} hand`}
                titleLevel={3}
                actions={
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => update({ step: 1 })}
                  >
                    Redo camera range
                  </Button>
                }
              >
                <ul className="cal-review__list">
                  {fingers.map((f) => {
                    const issue = issueFor(f, 'camera');
                    return (
                      <li key={f} className="cal-review__row">
                        <span
                          className="cal-dot"
                          style={{ background: `var(--finger-${f})` }}
                        />
                        <span className="cal-review__name">{title(f)}</span>
                        <RangeBar
                          compact
                          min={0}
                          max={flexMax}
                          from={draft.open?.raw[f]}
                          to={draft.closed?.raw[f]}
                          tone={issue ? 'caution' : 'reached'}
                        />
                        <span className="cal-review__val">
                          {draft.open?.raw[f].toFixed(0) ?? '–'}° →{' '}
                          {draft.closed?.raw[f].toFixed(0) ?? '–'}°
                        </span>
                        <span
                          className={
                            issue ? 'cal-review__issue' : 'cal-review__ok'
                          }
                        >
                          {issue?.message ?? 'Ready'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
            <details
              className="hp-disclosure"
              open={draftStatus.state === 'invalid' ? true : undefined}
            >
              <summary>Exact values</summary>
              <table className="hp-table">
                <caption>Glove angles</caption>
                <thead>
                  <tr>
                    <th scope="col">Finger</th>
                    <th scope="col" className="hp-num">
                      Slack
                    </th>
                    <th scope="col" className="hp-num">
                      Open
                    </th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {GLOVE_FINGERS.map((f) => (
                    <tr key={f}>
                      <th scope="row">{title(f)}</th>
                      <td className="hp-num">{draft.servo[f]?.min_deg}°</td>
                      <td className="hp-num">{draft.servo[f]?.max_deg}°</td>
                      <td>{issueFor(f, 'glove')?.message ?? 'Ready'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="hp-table">
                <caption>Camera range · {draft.hand} hand</caption>
                <thead>
                  <tr>
                    <th scope="col">Finger</th>
                    <th scope="col" className="hp-num">
                      Open
                    </th>
                    <th scope="col" className="hp-num">
                      Closed
                    </th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {fingers.map((f) => (
                    <tr key={f}>
                      <th scope="row">{title(f)}</th>
                      <td className="hp-num">
                        {draft.open?.raw[f].toFixed(1)}°
                      </td>
                      <td className="hp-num">
                        {draft.closed?.raw[f].toFixed(1)}°
                      </td>
                      <td>{issueFor(f, 'camera')?.message ?? 'Ready'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <details className="hp-disclosure">
              <summary>Advanced</summary>
              <Input
                label="Current limit (mA)"
                hint="Between 100 and 2200 mA. The glove stops above this current."
                type="number"
                min={100}
                max={2200}
                value={draft.limit}
                onChange={(e) => update({ limit: Number(e.target.value) })}
              />
            </details>
            <div className="hp-wizard__footer">
              {back(1)}
              <Button
                variant="primary"
                disabled={busy || draftStatus.state !== 'ok'}
                onClick={() => void action(save)}
              >
                Save calibration
              </Button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
