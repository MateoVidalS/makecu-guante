import { useEffect, useRef, useState } from 'react';
import {
  Banner,
  ButtonLink,
  Card,
  Stack,
  Inline,
  PageHeader,
  Select,
  Input,
  Slider,
  Checkbox,
  Icon,
  ProgressRing,
} from '../../design-system';
import { useRuntime, RuntimeSimulatorCalibration } from '../../runtime';

import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import { GLOVE_FINGERS } from '../../contracts/glove';
import type { ServoCalibration } from '../../contracts/calibration';
import type { VisionFrame } from '../../contracts/vision';
import { BigButton, Stepper, title } from '../../components/common';
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
  const runtime = useRuntime(),
    { client } = useGlove(),
    vision = useVision();
  const [draft, setDraft] = useState(loadDraft),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [capture, setCapture] = useState(false),
    [progress, setProgress] = useState(0),
    [offHand, setOffHand] = useState(false),
    [ack, setAck] = useState(false),
    [saved, setSaved] = useState(false);
  const mirror = draft.mirror;
  const current = useGloveTelemetry((t) => t?.ma ?? 0);
  const cancel = useRef<() => void>(() => {}),
    mounted = useRef(true),
    draftRef = useRef(draft);
  draftRef.current = draft;
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
      if (e.e === 'calib_ok') {
        setAck(true);
        setDraft((d) => (d.step === 0 ? { ...d, step: 1 } : d));
      }
      if (
        ['overcurrent', 'stop_button', 'watchdog', 'ina_missing'].includes(e.e)
      ) {
        client.release();
        cancel.current();
        setError('Glove stopped. Check the glove before continuing.');
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
      client.limit(runtime.calibration.current?.current_limit_ma ?? 900);
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
    client.jog(draft.finger as 0 | 1 | 2, bounded);
    update({ angle: bounded });
  }
  function setRange(key: 'min_deg' | 'max_deg') {
    update({
      servo: {
        ...draft.servo,
        [finger]: { ...range, finger, [key]: draft.angle },
      },
    });
    setAck(false);
  }
  async function sendRanges() {
    if (!GLOVE_FINGERS.every((f) => validRange(draft.servo[f])))
      throw new Error(
        'Set comfortable open and closed angles for every finger.',
      );
    if (client.connection() !== 'connected')
      throw new Error('Connect the glove first.');
    client.release();
    GLOVE_FINGERS.forEach((f, i) => {
      const r = draft.servo[f]!;
      client.calib(i as 0 | 1 | 2, r.min_deg!, r.max_deg!);
    });
  }
  function captureRange(kind: 'open' | 'closed' | 'pinch') {
    if (client.connection() !== 'connected') {
      setError('Connect the glove first.');
      return;
    }
    setError('');
    setCapture(true);
    setProgress(0);
    const frames: VisionFrame[] = [],
      started = performance.now();
    if (kind === 'closed') {
      client.limit(400);
      client.target([1, 1, 1], 0.3);
    }
    // Wait for the glove to settle before starting the hold interval.
    const settle = kind === 'closed' ? 4000 : 0;
    const unsubscribe = vision.source.onFrame((frame) => {
      const elapsed = performance.now() - started - settle;
      if (elapsed >= 0) {
        frames.push(frame);
        setProgress(Math.min(100, elapsed / 20));
      }
    });
    const timer = setTimeout(() => {
      unsubscribe();
      client.release();
      setCapture(false);
      cancel.current = () => {};
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
    }, settle + 2100);
    cancel.current = () => {
      clearTimeout(timer);
      unsubscribe();
      client.release();
      if (mounted.current) setCapture(false);
    };
  }
  async function save() {
    if (
      !draft.open ||
      !draft.closed ||
      !draft.pinch ||
      !GLOVE_FINGERS.every((f) => validRange(draft.servo[f])) ||
      !Number.isFinite(draft.limit) ||
      draft.limit < 100 ||
      draft.limit > 1400
    )
      throw new Error('Complete each calibration step before saving.');
    const camera = {
      affected_hand: draft.hand,
      open_flex: draft.open.raw,
      closed_flex: draft.closed.raw,
      pinch_open: draft.open.pinch,
      pinch_closed: draft.pinch.pinch,
    };
    await runtime.calibration.save({
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
  if (saved)
    return (
      <Stack as="section">
        <h1>Your range is saved</h1>
        <p>You're ready to practice.</p>
        <ButtonLink variant="primary" to="/exercise">
          Start practice
        </ButtonLink>
      </Stack>
    );
  return (
    <Stack as="section" gap={24}>
      <PageHeader
        title="Find your comfortable range"
        lead="Your progress stays here if you leave."
      />

      <RuntimeSimulatorCalibration />
      <Stepper
        labels={['Glove range', 'Camera range', 'Glove friction', 'Review']}
        step={draft.step}
        disabled={busy || capture}
        onStep={(step) => {
          cancel.current();
          client.release();
          update({ step });
        }}
      />
      <Banner
        tone="warning"
        title="Keep the hand relaxed. Press STOP anytime."
        action={
          <BigButton
            onClick={() => {
              cancel.current();
              client.release();
              void runtime.evaluation.stop();
            }}
          >
            Release glove now
          </BigButton>
        }
      />
      {error && <p role="alert">{error}</p>}
      {draft.step === 0 && (
        <Card className="live-stack">
          <h2>Step 1 · Glove range: {title(finger)}</h2>
          <p>Hand relaxed. Stop if it hurts.</p>
          <p>Move gently. Find a comfortable range without pain.</p>
          <p>
            Servo angle: {draft.angle}° · Current: {Math.round(current)} mA
          </p>
          {current > 400 && (
            <p role="alert">
              Resistance is rising. Release the glove and check the fit.
            </p>
          )}
          <div className="actions">
            {[-5, -1, 1, 5].map((n) => (
              <BigButton key={n} onClick={() => jog(draft.angle + n)}>
                {n > 0 ? '+' : '−'}
                {Math.abs(n)}°
              </BigButton>
            ))}
          </div>
          <Slider
            label="Servo angle"
            min={5}
            max={175}
            value={draft.angle}
            onValueChange={jog}
            format={(v) => `${v}°`}
          />
          <p>Thread just tight, finger fully open.</p>
          <BigButton onClick={() => setRange('min_deg')}>
            Set open{range?.min_deg != null ? ` ✓ ${range.min_deg}°` : ''}
          </BigButton>
          <p>Finger comfortably closed, without pain.</p>
          <BigButton onClick={() => setRange('max_deg')}>
            Set closed{range?.max_deg != null ? ` ✓ ${range.max_deg}°` : ''}
          </BigButton>
          <p>Open and closed must differ by at least 20°.</p>
          <div className="actions">
            {GLOVE_FINGERS.map((f, i) => (
              <BigButton
                key={f}
                onClick={() => {
                  client.release();
                  update({ finger: i, angle: 90 });
                }}
              >
                <Icon name={validRange(draft.servo[f]) ? 'check' : 'info'} />{' '}
                {title(f)} ·{' '}
                {validRange(draft.servo[f])
                  ? 'Set'
                  : i === draft.finger
                    ? 'Editing'
                    : 'Not set'}
              </BigButton>
            ))}
          </div>
          <BigButton
            disabled={!validRange(range)}
            onClick={() => {
              client.release();
              update({ finger: Math.min(2, draft.finger + 1), angle: 90 });
            }}
          >
            Next finger
          </BigButton>
          <Inline justify="between">
            <ButtonLink to="/setup">Back</ButtonLink>
            <BigButton
              variant="primary"
              disabled={
                busy || !GLOVE_FINGERS.every((f) => validRange(draft.servo[f]))
              }
              onClick={() => void action(sendRanges)}
            >
              Send glove ranges
            </BigButton>
          </Inline>
          {ack && (
            <BigButton onClick={() => update({ step: 1 })}>
              Continue to camera range
            </BigButton>
          )}
          {client.kind !== 'sim' && (
            <p>Wait for the glove to confirm its ranges.</p>
          )}
        </Card>
      )}
      {draft.step === 1 && (
        <Card className="live-stack">
          <h2>Step 2 · Camera range</h2>
          {vision.source.kind === 'sim' && runtime.calibration.current && (
            <>
              <p>Use example values to preview calibration without a camera.</p>
              <BigButton
                onClick={() => {
                  const c = runtime.calibration.current!.camera;
                  update({
                    open: { raw: c.open_flex, pinch: c.pinch_open },
                    closed: { raw: c.closed_flex, pinch: c.pinch_closed },
                    pinch: { raw: c.closed_flex, pinch: c.pinch_closed },
                    hand: c.affected_hand,
                  });
                }}
              >
                Use example camera range (simulator)
              </BigButton>
            </>
          )}

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
          <CameraOverlay mirrored={mirror} />
          <p>Keep your hand still for two seconds.</p>
          {capture && (
            <div role="status">
              {progress === 0 ? 'Get into position…' : 'Hold still…'}
              <ProgressRing value={progress / 100} label="Hold still" />
            </div>
          )}
          <BigButton disabled={capture} onClick={() => captureRange('open')}>
            Capture open hand {draft.open && '✓'}
          </BigButton>
          <p>Relax while the glove closes your hand.</p>
          <p>Make your best fist with your free fingers.</p>
          <BigButton
            disabled={capture || !draft.open}
            onClick={() => captureRange('closed')}
          >
            Glove closes the hand {draft.closed && '✓'}
          </BigButton>
          <BigButton
            disabled={capture || !draft.closed || !draft.open}
            onClick={() => {
              const d = draftRef.current;
              update({
                closed: {
                  ...d.closed!,
                  raw: {
                    ...d.closed!.raw,
                    ring: d.open!.raw.ring + 180,
                    pinky: d.open!.raw.pinky + 180,
                  },
                },
              });
            }}
          >
            Use estimates for ring and pinky
          </BigButton>
          <p>Touch thumb to index. A helper can assist.</p>
          <BigButton
            disabled={capture || !draft.closed}
            onClick={() => captureRange('pinch')}
          >
            Capture pinch {draft.pinch && '✓'}
          </BigButton>
          <BigButton disabled={!capture} onClick={() => cancel.current()}>
            Cancel capture and release
          </BigButton>
          <Inline justify="between">
            <BigButton
              disabled={busy || capture}
              onClick={() => {
                client.release();
                update({ step: 0 });
              }}
            >
              Back
            </BigButton>
            <BigButton
              variant="primary"
              disabled={capture || !draft.open || !draft.closed || !draft.pinch}
              onClick={() => {
                client.release();
                update({ step: 2 });
              }}
            >
              Continue to friction
            </BigButton>
          </Inline>
        </Card>
      )}
      {draft.step === 2 && (
        <Card className="live-stack">
          <h2>Step 3 · Glove friction</h2>
          <p>Take the glove off. Let it hang freely.</p>
          <Checkbox
            label="The glove is off the hand"
            checked={offHand}
            disabled={busy}
            onChange={(e) => setOffHand(e.target.checked)}
          />
          <Inline justify="between">
            <BigButton
              disabled={busy || capture}
              onClick={() => {
                client.release();
                update({ step: 1 });
              }}
            >
              Back
            </BigButton>
            <BigButton
              variant="primary"
              disabled={!offHand || busy}
              onClick={() =>
                void action(async () => {
                  const friction =
                    await runtime.evaluation.runFriction(GLOVE_FINGERS);
                  if (mounted.current) update({ friction, step: 3 });
                })
              }
            >
              {busy ? 'Measuring friction…' : 'Measure glove friction'}
            </BigButton>
          </Inline>
          <BigButton
            disabled={busy}
            onClick={() => update({ friction: {}, step: 3 })}
          >
            Skip friction measurement
          </BigButton>
          <p>Skipping uses estimates without glove friction correction.</p>
        </Card>
      )}
      {draft.step === 3 && (
        <Card className="live-stack">
          <h2>Review your range</h2>
          <table>
            <caption>Glove angles</caption>
            <thead>
              <tr>
                <th>Finger</th>
                <th>Open</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {GLOVE_FINGERS.map((f) => (
                <tr key={f}>
                  <th>{title(f)}</th>
                  <td>{draft.servo[f]?.min_deg}°</td>
                  <td>{draft.servo[f]?.max_deg}°</td>
                </tr>
              ))}
            </tbody>
          </table>
          <BigButton onClick={() => update({ step: 0 })}>
            Redo glove ranges
          </BigButton>
          <table>
            <caption>Camera range · {draft.hand} hand</caption>
            <thead>
              <tr>
                <th>Finger</th>
                <th>Open</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {fingers.map((f) => (
                <tr key={f}>
                  <th>{title(f)}</th>
                  <td>{draft.open?.raw[f].toFixed(1)}°</td>
                  <td>{draft.closed?.raw[f].toFixed(1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Pinch: {draft.open?.pinch.toFixed(3)} →{' '}
            {draft.pinch?.pinch.toFixed(3)}
          </p>
          <BigButton onClick={() => update({ step: 1 })}>
            Redo camera range
          </BigButton>
          <details>
            <summary>
              Friction curves ({Object.keys(draft.friction).length} fingers)
            </summary>
            <pre>{JSON.stringify(draft.friction, null, 2)}</pre>
          </details>
          <BigButton onClick={() => update({ step: 2 })}>
            Redo friction
          </BigButton>
          <Input
            label="Current limit (mA)"
            type="number"
            min={100}
            max={1400}
            value={draft.limit}
            onChange={(e) => update({ limit: Number(e.target.value) })}
          />
          <Inline justify="between">
            <BigButton
              disabled={busy || capture}
              onClick={() => {
                client.release();
                update({ step: 2 });
              }}
            >
              Back
            </BigButton>
            <BigButton
              variant="primary"
              disabled={busy}
              onClick={() => void action(save)}
            >
              Save calibration
            </BigButton>
          </Inline>
        </Card>
      )}
    </Stack>
  );
}
