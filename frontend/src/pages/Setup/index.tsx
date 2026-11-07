import { Fragment, useEffect, useState } from 'react';
import {
  Button,
  ButtonLink,
  PageHeader,
  Select,
  Checkbox,
  StatusDot,
  type StatusTone,
} from '../../design-system';
import { useStore } from 'zustand';
import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision, useVisionFrame } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import { useRuntime, RuntimeDiagnostics } from '../../runtime';
import {
  BrowserSupportBanner,
  Readouts,
  Section,
  percent,
  title,
} from '../../components/common';
import type { PatientPreset } from '../../glove/sim/patient';
import type { GloveInfo } from '../../contracts/glove';
export default function Setup() {
  const glove = useGlove(),
    vision = useVision(),
    runtime = useRuntime();
  const connection = useStore(glove.store, (s) => s.connection),
    events = useStore(glove.store, (s) => s.events);
  const tel = useGloveTelemetry((t) => t);
  const cameraRunning = useVisionFrame((f) => f !== null);
  const confidence = useVisionFrame((f) =>
    f ? Math.round(f.confidence * 100) : null,
  );
  const seen = useVisionFrame((f) => !!f?.detected && f.confidence >= 0.6);
  const handedness = useVisionFrame((f) => f?.handedness);
  const [info, setInfo] = useState<GloveInfo | null>(null),
    [error, setError] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDevice] = useState(''),
    [mirror, setMirror] = useState(true),
    [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<number[]>([]);
  const [, refreshControls] = useState(0);
  useEffect(() => {
    let last = 0;
    return glove.client.onTelemetry((t) => {
      if (t.t - last >= 100) {
        last = t.t;
        setSamples((s) => [...s, t.ma].slice(-100));
      }
    });
  }, [glove.client]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const message = (e as Error).message;
      setError(
        /comes in WP[23]/.test(message)
          ? 'Hardware connection is unavailable in this preview. Use the simulator.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function camera() {
    await vision.setKind('camera');
    try {
      await runtime.sources.setVision('camera');
    } catch (e) {
      if (!/comes in WP3/.test((e as Error).message)) throw e;
    }
    await vision.start({
      deviceId: deviceId || undefined,
      affectedHand:
        runtime.calibration.current?.camera.affected_hand ?? 'right',
    });
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }
  const connected = connection === 'connected';
  const fault = connected && tel?.st === 'fault';
  const gloveTone: StatusTone = fault
    ? 'danger'
    : connected
      ? 'reached'
      : connection === 'connecting'
        ? 'neutral'
        : 'off';
  const cameraTone: StatusTone = !cameraRunning
    ? 'off'
    : seen
      ? 'reached'
      : 'caution';
  const limit =
    info?.limit ?? runtime.calibration.current?.current_limit_ma ?? 900;
  const simulated = glove.client.kind === 'sim';
  return (
    <div className="hp-page">
      <PageHeader
        title="Connect glove and camera"
        lead="Both need to be ready before calibration and practice."
      />
      <BrowserSupportBanner />
      {error && (
        <p role="alert" className="hp-alert">
          {error}
        </p>
      )}
      <div className="hp-columns">
        <Section
          labelledBy="setup-glove"
          title={
            <>
              <StatusDot tone={gloveTone} />
              {connected
                ? fault
                  ? 'Glove stopped'
                  : 'Glove ready'
                : connection === 'connecting'
                  ? 'Connecting glove…'
                  : 'Glove not connected'}
            </>
          }
          description={
            connected
              ? fault
                ? 'Release the glove and check it before continuing.'
                : `Connected${simulated ? ' to the simulator' : ' over USB'}.`
              : connection === 'connecting'
                ? 'Waiting for the glove to answer.'
                : 'Plug in the glove, choose Connect, then pick the USB device.'
          }
        >
          <Readouts
            label="Glove readings"
            items={[
              {
                label: 'Current',
                value: tel ? Math.round(tel.ma) : '—',
                unit: 'mA',
              },
              { label: 'Limit', value: limit, unit: 'mA' },
              { label: 'State', value: tel?.st ? title(tel.st) : '—' },
            ]}
          />
          <div className="hp-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await glove.setKind('serial');
                  try {
                    await runtime.sources.setGlove('serial');
                  } catch (e) {
                    if (!/comes in WP2/.test((e as Error).message)) throw e;
                  }
                  setInfo(await glove.client.connect());
                })
              }
            >
              {connected ? 'Reconnect glove' : 'Connect glove'}
            </Button>
            {connected && (
              <Button
                variant="quiet"
                onClick={() => void action(() => glove.client.disconnect())}
              >
                Disconnect
              </Button>
            )}
            <Button variant="quiet" onClick={() => glove.client.release()}>
              Release glove
            </Button>
          </div>
          <details className="hp-disclosure">
            <summary>Glove diagnostics</summary>
            <dl>
              <dt>Mode</dt>
              <dd>{tel?.md ?? '—'}</dd>
              {info && (
                <>
                  <dt>Firmware</dt>
                  <dd>
                    {info.fw} · {info.calib.filter(Boolean).length} calibrated
                    fingers
                  </dd>
                </>
              )}
              {['thumb', 'index', 'middle', 'ring', 'pinky'].map((f, i) => (
                <Fragment key={f}>
                  <dt>{title(f)}</dt>
                  <dd>
                    {percent(tel?.a[i])} · target {percent(tel?.tg?.[i])}
                  </dd>
                </Fragment>
              ))}
              <dt>Telemetry age</dt>
              <dd>
                {tel
                  ? `${Math.round(Math.max(0, performance.now() - tel.t))} ms`
                  : '—'}
              </dd>
            </dl>
            <svg
              viewBox="0 0 500 100"
              role="img"
              aria-label="Current over the last ten seconds"
            >
              <path
                d={`M0 ${100 - limit / 14}H500`}
                stroke="var(--target)"
                strokeDasharray="4 4"
              />
              <polyline
                points={samples
                  .map((s, i) => `${i * 5},${100 - s / 14}`)
                  .join(' ')}
                fill="none"
                stroke="var(--text)"
              />
            </svg>
            {events.length > 0 && (
              <ul aria-label="Recent glove events">
                {events.slice(-10).map((e, i) => (
                  <li key={i}>
                    {e.e} {e.ma != null ? `${Math.round(e.ma)} mA` : ''}
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              disabled={!runtime.calibration.current || !connected}
              onClick={() =>
                void action(() => runtime.calibration.sendToGlove())
              }
            >
              Send calibration
            </Button>
          </details>
        </Section>
        <Section
          labelledBy="setup-camera"
          title={
            <>
              <StatusDot tone={cameraTone} />
              {!cameraRunning
                ? 'Camera off'
                : seen
                  ? 'Camera sees the hand'
                  : "Camera can't see the hand"}
            </>
          }
          description={
            cameraRunning
              ? 'Keep the whole hand inside the frame.'
              : 'Choose a camera, then connect it.'
          }
        >
          <Readouts
            label="Camera readings"
            items={[
              {
                label: 'Confidence',
                value: confidence ?? '—',
                unit: confidence == null ? undefined : '%',
              },
              {
                label: 'Hand',
                value: handedness ? title(handedness) : 'Not seen',
              },
            ]}
          />
          <Select
            label="Camera device"
            value={deviceId}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="">Default camera</option>
            {devices
              .filter((d) => d.kind === 'videoinput')
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
          </Select>
          <CameraOverlay mirrored={mirror} />
          <div className="hp-actions hp-actions--between">
            {cameraRunning ? (
              <Button variant="quiet" onClick={() => vision.stop()}>
                Stop camera
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void action(camera)}>
                Connect camera
              </Button>
            )}
            <Checkbox
              label="Mirror preview"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
          </div>
        </Section>
      </div>
      <Section
        title={<span className="hp-label">Simulator</span>}
        description="Practice without hardware. Simulated readings are estimates."
        actions={
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await runtime.sources.setGlove('sim');
                await glove.setKind('sim');
                await runtime.sources.setVision('sim');
                await vision.setKind('sim');
                vision.setCalibration(
                  runtime.calibration.current?.camera ?? null,
                );
                setInfo(await glove.client.connect());
                await vision.start({ affectedHand: 'right' });
              })
            }
          >
            Use simulator
          </Button>
        }
      >
        {simulated && (
          <details className="hp-disclosure">
            <summary>Simulated patient and faults</summary>
            <div className="hp-stack">
              <Select
                label="Patient preset"
                value={glove.world.patient.preset}
                onChange={(e) => {
                  glove.world.controls.setPreset(
                    e.target.value as PatientPreset,
                  );
                  refreshControls((n) => n + 1);
                }}
              >
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </Select>
              <Checkbox
                label="Rigid index"
                checked={glove.world.patient.rigid.index}
                onChange={(e) => {
                  glove.world.controls.setRigid('index', e.target.checked);
                  refreshControls((n) => n + 1);
                }}
              />
              <div className="hp-actions">
                <Button
                  size="sm"
                  onClick={() => glove.world.controls.pressStop()}
                >
                  Press STOP
                </Button>
                <Button
                  size="sm"
                  onClick={() => glove.world.controls.releaseStop()}
                >
                  Release STOP
                </Button>
                <Button size="sm" onClick={() => glove.world.controls.unplug()}>
                  Unplug USB
                </Button>
                <Button
                  size="sm"
                  disabled={vision.source !== glove.world.vision}
                  onClick={() => glove.world.controls.handOutOfFrame(5000)}
                >
                  Hand out of frame
                </Button>
              </div>
              {vision.source !== glove.world.vision && (
                <p className="hp-note">
                  Camera fault controls need the shared simulator connection.
                </p>
              )}
            </div>
          </details>
        )}
        <details className="hp-disclosure hp-plain">
          <summary>System diagnostics</summary>
          <RuntimeDiagnostics />
        </details>
      </Section>
      <div className="hp-actions hp-actions--end">
        <ButtonLink variant="primary" to="/calibrate">
          Continue to calibration
        </ButtonLink>
      </div>
    </div>
  );
}
