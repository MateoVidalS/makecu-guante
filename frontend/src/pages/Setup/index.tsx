import { Fragment, useEffect, useState } from 'react';
import {
  Button,
  ButtonLink,
  PageHeader,
  Select,
  Checkbox,
  StatusDot,
  StatusChip,
  Card,
  Inline,
  type StatusTone,
} from '../../design-system';
import { useStore } from 'zustand';
import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision, useVisionFrame } from '../../vision';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { CameraPlacement, GloveDetectionCheck } from './CameraPlacement';
import { SetupCameraPreview } from './SetupCameraPreview';
import {
  CurrentSensorNotice,
  useCurrentSensorMissing,
} from './CurrentSensorNotice';
import {
  useRuntime,
  RuntimeDiagnostics,
  RuntimeBrownoutNotice,
} from '../../runtime';
import {
  BrowserSupportBanner,
  Readouts,
  percent,
  title,
} from '../../components/common';
import type { GloveInfo } from '../../contracts/glove';
export default function Setup() {
  const glove = useGlove(),
    vision = useVision(),
    runtime = useRuntime();
  const connection = useStore(glove.store, (s) => s.connection),
    events = useStore(glove.store, (s) => s.events),
    connectionError = useStore(glove.store, (s) => s.connectionError);
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
    [busy, setBusy] = useState(false),
    [cameraBusy, setCameraBusy] = useState(false),
    [simulating, setSimulating] = useState(false),
    [rawPreviewReady, setRawPreviewReady] = useState(false);
  const [samples, setSamples] = useState<number[]>([]);
  useEffect(() => {
    let last = 0;
    return glove.client.onTelemetry((t) => {
      if (t.t - last >= 100) {
        last = t.t;
        setSamples((s) => [...s, t.ma].slice(-100));
      }
    });
  }, [glove.client]);
  async function action(
    fn: () => Promise<unknown>,
    target: 'glove' | 'camera' = 'glove',
  ) {
    const setActionBusy = target === 'camera' ? setCameraBusy : setBusy;
    setError('');
    if (target === 'glove') setInfo(null);
    setActionBusy(true);
    try {
      await fn();
    } catch (e) {
      const message = (e as Error).message;
      // A USB attempt the helper cancelled (or replaced with the simulator) is not an error.
      if (/Connection cancelled|Serial disconnected/.test(message)) return;
      setError(
        /comes in WP[23]/.test(message)
          ? 'Hardware connection is unavailable in this preview. Use the simulator.'
          : /^no_info$/.test(message)
            ? 'A USB device answered, but not as the Rehab glove. Check that the board is flashed with the glove firmware and finished starting, then try again, or choose Simulate glove.'
            : /No port selected|requestPort|NotFoundError/i.test(message)
              ? "No glove was selected. If the glove isn't here, choose Simulate glove: the camera still tracks your real hand and the app shows which motor would help."
              : message,
      );
    } finally {
      setActionBusy(false);
    }
  }
  /** Drop a pending or stuck USB attempt; the serial client rejects it as cancelled. */
  async function cancelSerial() {
    const client = glove.store.getState().client;
    if (client.kind === 'serial') await client.disconnect();
    setBusy(false);
  }
  /**
   * Only the glove becomes simulated: no motor moves, the camera keeps tracking the real hand.
   * Never blocked by a USB attempt that is still pending; it cancels that attempt first.
   */
  async function simulateGlove() {
    setError('');
    setInfo(null);
    setSimulating(true);
    try {
      await cancelSerial();
      await glove.setKind('sim');
      await runtime.sources.setGlove('sim');
      setInfo(await glove.store.getState().client.connect());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulating(false);
    }
  }
  async function camera() {
    await vision.setKind('camera', {
      deviceId: deviceId || undefined,
      affectedHand:
        runtime.calibration.current?.camera.affected_hand ?? 'right',
    });
    try {
      await runtime.sources.setVision('camera');
    } catch (e) {
      if (!/comes in WP3/.test((e as Error).message)) throw e;
    }
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }
  const missingCurrentSensor = useCurrentSensorMissing();
  const connected = connection === 'connected';
  const fault = connected && tel?.st === 'fault';
  const gloveTone: StatusTone = fault
    ? 'danger'
    : connected
      ? missingCurrentSensor
        ? 'caution'
        : 'reached'
      : connection === 'connecting'
        ? 'neutral'
        : 'off';
  const cameraAvailable = cameraRunning || rawPreviewReady;
  const cameraTone: StatusTone = !cameraAvailable
    ? 'off'
    : seen
      ? 'reached'
      : 'caution';
  const limit =
    info?.limit ?? runtime.calibration.current?.current_limit_ma ?? 1500;
  const simulated = glove.client.kind === 'sim';
  return (
    <div className="hp-page setup-page">
      <PageHeader
        title="Connect glove and camera"
        lead="Both need to be ready before calibration and practice."
      />
      <RuntimeBrownoutNotice />
      <CurrentSensorNotice missing={missingCurrentSensor} />
      <BrowserSupportBanner />
      {(error || connectionError) && (
        <p role="alert" className="hp-alert">
          {error || connectionError}
        </p>
      )}
      <div className="setup-readiness" aria-label="Setup readiness">
        <Inline>
          <StatusChip
            label="Glove"
            value={
              fault
                ? 'Stopped'
                : connected
                  ? missingCurrentSensor
                    ? 'Calibration only'
                    : 'Ready'
                  : 'Not connected'
            }
            tone={gloveTone}
          />
          <StatusChip
            label="Camera"
            value={seen ? 'Sees the hand' : "Can't see the hand"}
            tone={cameraTone}
          />
        </Inline>
        <ButtonLink
          variant="primary"
          to="/calibrate"
          aria-disabled={!connected || !seen || fault}
          onClick={(e) => {
            if (!connected || !seen || fault) e.preventDefault();
          }}
        >
          Continue to calibration
        </ButtonLink>
      </div>
      <div className="setup-cards">
        <Card
          aria-label="Glove connection"
          title={
            <>
              <StatusDot tone={gloveTone} />
              {connected
                ? fault
                  ? 'Glove stopped'
                  : missingCurrentSensor
                    ? 'Glove calibration only'
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
                : simulated
                  ? vision.source.kind === 'sim'
                    ? 'Simulated glove and camera. No motors move.'
                    : 'Simulated glove. No motors move. Your camera tracks your hand.'
                  : 'Connected over USB.'
              : connection === 'connecting'
                ? 'Waiting for the glove to answer.'
                : 'Plug in the glove, choose Connect, then pick the USB device.'
          }
        >
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
            {connection === 'connecting' && !simulated && (
              <Button variant="quiet" onClick={() => void cancelSerial()}>
                Cancel
              </Button>
            )}
            {!(connected && simulated) && (
              <Button
                variant="secondary"
                disabled={simulating}
                onClick={() => void simulateGlove()}
              >
                Simulate glove
              </Button>
            )}
            <Button variant="quiet" onClick={() => glove.client.release()}>
              Release glove
            </Button>
          </div>
        </Card>
        <Card
          aria-label="Camera connection"
          title={
            <>
              <StatusDot tone={cameraTone} />
              {!cameraAvailable
                ? 'Camera off'
                : seen
                  ? 'Camera sees the hand'
                  : "Camera can't see the hand"}
            </>
          }
          description={
            cameraAvailable
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
          <SetupCameraPreview
            mirrored={mirror}
            onVideoReady={setRawPreviewReady}
          />
          {rawPreviewReady && !cameraRunning && (
            <p role="status">Camera ready. Hand tracking is loading.</p>
          )}
          <div className="hp-actions hp-actions--between">
            {cameraAvailable ? (
              <Button variant="quiet" onClick={() => vision.stop()}>
                Stop camera
              </Button>
            ) : (
              <Button
                disabled={cameraBusy}
                onClick={() => void action(camera, 'camera')}
              >
                Connect camera
              </Button>
            )}
            <Checkbox
              label="Mirror preview"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
          </div>
        </Card>
      </div>
      <GloveDetectionCheck />
      <details
        className="hp-disclosure"
        open={seen ? undefined : true}
        key={seen ? 'seen' : 'unseen'}
      >
        <summary>How to place the camera</summary>
        <CameraPlacement />
      </details>
      <details className="hp-disclosure">
        <summary>Advanced</summary>
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
        {connected && (
          <Button
            variant="quiet"
            onClick={() => void action(() => glove.client.disconnect())}
          >
            Disconnect
          </Button>
        )}
        <h2>Glove diagnostics</h2>
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
          {GLOVE_FINGERS.map((f, i) => (
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
            d={`M0 ${100 - (limit / 2500) * 100}H500`}
            stroke="var(--target)"
            strokeDasharray="4 4"
          />
          <polyline
            points={samples
              .map(
                (s, i) => `${i * 5},${100 - (Math.min(s, 2500) / 2500) * 100}`,
              )
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
          onClick={() => void action(() => runtime.calibration.sendToGlove())}
        >
          Send calibration
        </Button>

        <h2>System diagnostics</h2>
        <RuntimeDiagnostics />
      </details>
    </div>
  );
}
