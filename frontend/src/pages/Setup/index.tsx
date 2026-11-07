import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useGlove, useGloveTelemetry } from '../../glove';
import { useVision, useVisionFrame } from '../../vision';
import { CameraOverlay } from '../../vision/CameraOverlay';
import { useRuntime } from '../../runtime';
import {
  BigButton,
  BrowserSupportBanner,
  GloveChip,
  CameraChip,
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
  const confidence = useVisionFrame((f) =>
    f ? Math.round(f.confidence * 100) : null,
  );
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
    await runtime.sources.setVision('camera');
    await vision.source.start({
      deviceId: deviceId || undefined,
      affectedHand:
        runtime.calibration.current?.camera.affected_hand ?? 'right',
    });
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }
  return (
    <section className="live-stack">
      <h1>Connect glove and camera</h1>
      <BrowserSupportBanner />
      {error && <p role="alert">{error}</p>}
      <div className="two-columns">
        <section className="card live-stack">
          <h2>
            {connection === 'connected' ? 'Glove ready' : 'Glove not connected'}
          </h2>
          <GloveChip />
          <p>Click Connect and pick the USB device.</p>
          <div className="actions">
            <BigButton
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
              {connection === 'connected' ? 'Reconnect glove' : 'Connect glove'}
            </BigButton>
            <BigButton
              onClick={() => void action(() => glove.client.disconnect())}
            >
              Disconnect
            </BigButton>
            <BigButton onClick={() => glove.client.release()}>
              Release glove
            </BigButton>
            <BigButton
              disabled={
                !runtime.calibration.current || connection !== 'connected'
              }
              onClick={() =>
                void action(() => runtime.calibration.sendToGlove())
              }
            >
              Send calibration
            </BigButton>
          </div>
          <details>
            <summary>Glove diagnostics</summary>
            <p>
              State: {tel?.st ?? 'Waiting'} · Mode: {tel?.md ?? '—'}
            </p>
            {info && (
              <p>
                Firmware: {info.fw} · Limit: {info.limit} mA ·{' '}
                {info.calib.filter(Boolean).length} calibrated fingers
              </p>
            )}
            {['thumb', 'index', 'middle'].map((f, i) => (
              <p key={f}>
                {title(f)}: {percent(tel?.a[i])} / target{' '}
                {percent(tel?.tg?.[i])}
              </p>
            ))}
            <p>
              Current: {tel?.ma ?? '—'} mA · Limit:{' '}
              {info?.limit ??
                runtime.calibration.current?.current_limit_ma ??
                900}{' '}
              mA
            </p>
            <svg
              viewBox="0 0 500 100"
              role="img"
              aria-label="Current over the last ten seconds"
            >
              <path
                d={`M0 ${100 - (info?.limit ?? runtime.calibration.current?.current_limit_ma ?? 900) / 14}H500`}
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
            <p>
              Telemetry age:{' '}
              {tel
                ? `${Math.round(Math.max(0, performance.now() - tel.t))} ms`
                : '—'}
            </p>
            <ul>
              {events.slice(-10).map((e, i) => (
                <li key={i}>
                  {e.e} {e.ma != null ? `${e.ma} mA` : ''}
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section className="card live-stack">
          <h2>Camera</h2>
          <CameraChip />
          <p>
            Confidence: {confidence == null ? '—' : `${confidence}%`} · Hand:{' '}
            {handedness ?? 'Not seen'}
          </p>
          <label>
            Camera device
            <select
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
            </select>
          </label>
          <BigButton disabled={busy} onClick={() => void action(camera)}>
            Connect camera
          </BigButton>
          <label>
            <input
              type="checkbox"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
            Mirror preview
          </label>
          <div className={mirror ? 'preview-mirrored' : undefined}>
            <CameraOverlay />
          </div>
          <BigButton onClick={() => vision.source.stop()}>
            Stop camera
          </BigButton>
        </section>
      </div>
      <section className="card simulator">
        <h2>Simulator</h2>
        <p>Practice without hardware. Simulated readings are estimates.</p>
        <BigButton
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await runtime.sources.setGlove('sim');
              await glove.setKind('sim');
              await runtime.sources.setVision('sim');
              setInfo(await glove.client.connect());
              await vision.source.start({ affectedHand: 'right' });
            })
          }
        >
          Use simulator
        </BigButton>
        {glove.client.kind === 'sim' && (
          <div className="live-stack">
            <label>
              Patient preset
              <select
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
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={glove.world.patient.rigid.index}
                onChange={(e) => {
                  glove.world.controls.setRigid('index', e.target.checked);
                  refreshControls((n) => n + 1);
                }}
              />
              Rigid index
            </label>
            <div className="actions">
              <BigButton onClick={() => glove.world.controls.pressStop()}>
                Press STOP
              </BigButton>
              <BigButton onClick={() => glove.world.controls.releaseStop()}>
                Release STOP
              </BigButton>
              <BigButton onClick={() => glove.world.controls.unplug()}>
                Unplug USB
              </BigButton>
              <BigButton
                disabled={vision.source !== glove.world.vision}
                onClick={() => glove.world.controls.handOutOfFrame(5000)}
              >
                Hand out of frame
              </BigButton>
            </div>
            {vision.source !== glove.world.vision && (
              <p className="muted">
                Camera fault controls need the shared simulator connection.
              </p>
            )}
          </div>
        )}
      </section>
      <Link className="button" to="/calibrate">
        Continue to calibration
      </Link>
    </section>
  );
}
