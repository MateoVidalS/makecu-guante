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
} from '../../design-system';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { useRuntime, RuntimeSimulatorCalibration } from '../../runtime';

import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision, useVisionFrame } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import { CalibrationClosure } from './closure';
import { GLOVE_FINGERS } from '../../contracts/glove';
import type { ServoCalibration } from '../../contracts/calibration';
import type { VisionFrame } from '../../contracts/vision';
import { Readouts, Section, Stepper, title } from '../../components/common';
import {
  fingers,
  loadDraft,
  saveDraft,
  freshDraft,
  stableCapture,
  validRange,
  type Draft,
} from './draft';
export default function Calibrate() {
  const navigate = useNavigate();
  const [short] = useShortPractice();
  const runtime = useRuntime(),
    { client } = useGlove(),
    vision = useVision();
  const [draft, setDraft] = useState(loadDraft),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(false),
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
    setDraft((d) => ({ ...d, ...patch }));
    setError('');
  }
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);
  useEffect(() => {
    if (draft.step === 1) {
      void vision
        .start({ affectedHand: draft.hand })
        .catch((e) => setError((e as Error).message));
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
      client.release();
      cancel.current();
      setError(`Glove: ${e.why.replaceAll('_', ' ')}`);
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
      servo: {
        ...draft.servo,
        [finger]: { ...range, finger, [key]: draft.angle },
      },
    });
  }
  async function sendRanges() {
    if (!GLOVE_FINGERS.every((f) => validRange(draft.servo[f])))
      throw new Error(
        'Set comfortable open and closed angles for every finger.',
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
    setCapture(true);
    setProgress(0);
    const frames: VisionFrame[] = [];
    const started = performance.now();
    let holdStarted: number | null = kind === 'closed' ? null : started;
    let lastFrameAt = started;
    const telemetry = client.latest();
    if (kind === 'closed' && !telemetry) {
      setCapture(false);
      setError('Wait for glove readings, then try again.');
      return;
    }
    const closure =
      kind === 'closed' ? new CalibrationClosure(telemetry!.a) : null;
    if (closure) client.limit(Math.min(1500, draft.limit));
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
      clearInterval(timer);
      unsubscribe();
      client.release();
      if (mounted.current) setCapture(false);
      cancel.current = () => {};
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
      const position = client.latest()?.a;
      if (closure && holdStarted === null && position) {
        if (closure.advance(now, position))
          client.target([...closure.target], 0.3);
        if (closure.settled(position)) holdStarted = now;
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
          kind === 'closed' &&
          draft.open &&
          GLOVE_FINGERS.some((f) => value.raw[f] - draft.open!.raw[f] < 20)
        )
          throw new Error('Move further from your open position. Try again.');
        if (kind === 'pinch' && draft.open && value.pinch >= draft.open.pinch)
          throw new Error('Touch your thumb and index finger. Try again.');
        update({ [kind]: value });
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
      open_flex: draft.open.raw,
      closed_flex: draft.closed.raw,
      pinch_open: draft.open.pinch,
      // Pinch practice is postponed; retain a valid contract value without another capture.
      pinch_closed: Math.min(draft.closed.pinch, draft.open.pinch * 0.5),
    };
    await runtime.calibration.save({
      servo: GLOVE_FINGERS.map((f) => draft.servo[f] as ServoCalibration),
      camera,
      friction: {},
      current_limit_ma: draft.limit,
    });
    await runtime.calibration.sendToGlove();
    vision.setCalibration(camera);
    saveDraft(freshDraft());
    setSaved(true);
  }
  const allRangesSet = GLOVE_FINGERS.every((f) => validRange(draft.servo[f]));
  const simulated = client.kind === 'sim' && vision.source.kind === 'sim';
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
  return (
    <div className="hp-page">
      <PageHeader
        title="Find your comfortable range"
        lead="Three short steps. Your progress is kept if you leave this page."
      />
      <div className="hp-wizard">
        <Stepper
          labels={['Glove range', 'Camera range', 'Review']}
          step={draft.step}
          disabled={busy || capture}
          onStep={(step) => {
            cancel.current();
            client.release();
            update({ step });
          }}
        />
        <div className="hp-safety-line" role="note">
          <p>
            <strong>Keep the hand relaxed. Press STOP anytime.</strong>
          </p>
          <Button
            size="sm"
            onClick={() => {
              cancel.current();
              client.release();
              void runtime.evaluation.stop();
            }}
          >
            Release glove now
          </Button>
        </div>
        {error && (
          <p role="alert" className="hp-alert">
            {error}
          </p>
        )}
        {draft.step === 0 && (
          <Section
            flush
            title={`Step 1 · Glove range: ${title(finger)}`}
            description="Rest palm down, forearm on a towel. Stop if it hurts."
          >
            <div
              className="hp-finger-tabs"
              role="group"
              aria-label="Finger to calibrate"
            >
              {GLOVE_FINGERS.map((f, i) => (
                <Button
                  key={f}
                  size="sm"
                  variant={i === draft.finger ? 'secondary' : 'quiet'}
                  aria-current={i === draft.finger ? 'step' : undefined}
                  onClick={() => {
                    client.release();
                    update({ finger: i, angle: 90 });
                  }}
                >
                  {title(f)} ·{' '}
                  {validRange(draft.servo[f])
                    ? 'Set'
                    : i === draft.finger
                      ? 'Editing'
                      : 'Not set'}
                </Button>
              ))}
            </div>
            <p className="hp-note">
              Five servos share a 5 V, 2.5 A supply. Adjust one finger at a
              time. The normal limit is 1500 mA; never exceed 2200 mA. Keep the
              wrist module at the table edge, fingers free.
            </p>
            <Readouts
              label="Live glove readings"
              items={[
                { label: 'Current', value: Math.round(current), unit: 'mA' },
                { label: 'Limit while adjusting', value: 400, unit: 'mA' },
              ]}
            />
            {current > 400 && (
              <p role="alert" className="hp-alert">
                Resistance is rising. Release the glove and check the fit.
              </p>
            )}
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
                <Button key={n} size="sm" onClick={() => jog(draft.angle + n)}>
                  {n > 0 ? '+' : '−'}
                  {Math.abs(n)}°
                </Button>
              ))}
            </div>
            <div>
              <div className="hp-set-row">
                <div>
                  <p>Open: thread just tight, finger fully open.</p>
                  <p className="hp-set-row__value">
                    {range?.min_deg != null
                      ? `Open at ${range.min_deg}°`
                      : 'Open not set'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setRange('min_deg')}>
                  Set open
                </Button>
              </div>
              <div className="hp-set-row">
                <div>
                  <p>Closed: finger comfortably closed, without pain.</p>
                  <p className="hp-set-row__value">
                    {range?.max_deg != null
                      ? `Closed at ${range.max_deg}°`
                      : 'Closed not set'}
                  </p>
                </div>
                <Button size="sm" onClick={() => setRange('max_deg')}>
                  Set closed
                </Button>
              </div>
            </div>
            <p className="hp-note">
              Open and closed must differ by at least 20°.
              {client.kind !== 'sim' &&
                ' After sending, wait for the glove to confirm its ranges.'}
            </p>
            <div className="hp-wizard__footer">
              <ButtonLink variant="quiet" to="/setup">
                Back
              </ButtonLink>
              <div className="hp-actions">
                <Button
                  variant="primary"
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
                      update({ finger: draft.finger + 1, angle: 90 });
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
            title="Step 2 · Camera range"
            description="Palm down. Keep still for two seconds during each capture."
          >
            <div className="hp-actions hp-actions--between">
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
            </div>
            <div className="hp-camera">
              <CameraOverlay mirrored={mirror} />
            </div>
            {capture && (
              <div role="status" className="hp-capture-status">
                <ProgressRing
                  value={progress / 100}
                  label="Hold still"
                  size={32}
                  thickness={4}
                />
                {progress === 0 ? 'Get into position…' : 'Hold still…'}
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => cancel.current()}
                >
                  Cancel capture and release
                </Button>
              </div>
            )}
            <div>
              <div className="hp-set-row">
                <div>
                  <p>Open hand, fingers straight.</p>
                  <p className="hp-set-row__value">
                    {draft.open ? 'Captured' : 'Not captured'}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={capture || !seen}
                  onClick={() => captureRange('open')}
                >
                  Capture open hand
                </Button>
              </div>
              <div className="hp-set-row">
                <div>
                  <p>
                    Relax while the glove closes all five fingers in stages.
                    Close only as far as the glove goes, without pain.
                  </p>
                  <p className="hp-set-row__value">
                    {draft.closed ? 'Captured' : 'Not captured'}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={capture || !draft.open || !seen}
                  onClick={() => captureRange('closed')}
                >
                  Glove closes the hand
                </Button>
              </div>
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
            <p>All five glove ranges and both camera captures are ready.</p>
            <p>Current limit: {draft.limit} mA</p>
            <details className="hp-disclosure">
              <summary>Details</summary>
              <table className="hp-table">
                <caption>Glove angles</caption>
                <thead>
                  <tr>
                    <th scope="col">Finger</th>
                    <th scope="col" className="hp-num">
                      Open
                    </th>
                    <th scope="col" className="hp-num">
                      Closed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GLOVE_FINGERS.map((f) => (
                    <tr key={f}>
                      <th scope="row">{title(f)}</th>
                      <td className="hp-num">{draft.servo[f]?.min_deg}°</td>
                      <td className="hp-num">{draft.servo[f]?.max_deg}°</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <div className="hp-actions">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => update({ step: 0 })}
              >
                Redo glove ranges
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => update({ step: 1 })}
              >
                Redo camera range
              </Button>
            </div>
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
                disabled={busy}
                onClick={() => void action(save)}
              >
                Save calibration
              </Button>
            </div>
          </Section>
        )}
      </div>
      {simulated && (
        <Section className="hp-plain">
          <RuntimeSimulatorCalibration />
        </Section>
      )}
    </div>
  );
}
