// Standalone Vite-only preview; integration pages remain owned by WP7.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Handedness, VisionSource } from '../contracts/vision';
import { createSimWorld } from '../glove/sim';
import { CameraVision } from './cameraVision';
import { CameraOverlay } from './CameraOverlay';
import '../styles/base.css';
import '@fontsource/atkinson-hyperlegible/400.css';

function Preview() {
  const camera = useMemo(() => new CameraVision(), []),
    sim = useMemo(() => createSimWorld().vision, []);
  const [source, setSource] = useState<VisionSource>(camera);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState('');
  const [hand, setHand] = useState<Handedness>('right'),
    [mirror, setMirror] = useState(camera.mirrorHandedness());
  const [status, setStatus] = useState('Choose a source to begin.'),
    [stats, setStats] = useState(camera.stats());
  useEffect(() => {
    void CameraVision.devices()
      .then(setDevices)
      .catch(() => {});
    const timer = setInterval(() => setStats(camera.stats()), 1000);
    return () => {
      clearInterval(timer);
      camera.stop();
      sim.stop();
    };
  }, [camera, sim]);
  async function start(kind: 'camera' | 'sim') {
    camera.stop();
    sim.stop();
    const next = kind === 'camera' ? camera : sim;
    setSource(next);
    setStatus('Starting…');
    try {
      await next.start({
        affectedHand: hand,
        ...(deviceId ? { deviceId } : {}),
      });
      setStatus(
        kind === 'camera'
          ? 'Camera running. Show your hand.'
          : 'Simulator running.',
      );
      if (kind === 'camera') setDevices(await CameraVision.devices());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Camera unavailable');
    }
  }
  return (
    <main>
      <h1>WP3 vision preview</h1>
      <p>
        Camera estimates run on this device. Calibration is provided by the
        setup wizard.
      </p>
      <div className="actions">
        <label>
          Camera{' '}
          <select
            aria-label="Camera"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Default camera</option>
            {devices.map((device, i) => (
              <option key={device.deviceId || i} value={device.deviceId}>
                {device.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Affected hand{' '}
          <select
            value={hand}
            onChange={(event) => setHand(event.target.value as Handedness)}
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={mirror}
            onChange={(event) => {
              setMirror(event.target.checked);
              camera.setMirrorHandedness(event.target.checked);
            }}
          />{' '}
          Mirror handedness
        </label>
      </div>
      <div className="actions">
        <button
          onClick={() => {
            void start('camera');
          }}
        >
          Start camera
        </button>
        <button
          onClick={() => {
            void start('sim');
          }}
        >
          Use simulator
        </button>
        <button
          onClick={() => {
            camera.stop();
            sim.stop();
            setStatus('Stopped.');
          }}
        >
          Stop
        </button>
        <button
          onClick={() => {
            document.documentElement.dataset.theme =
              document.documentElement.dataset.theme === 'dark'
                ? 'light'
                : 'dark';
          }}
        >
          Toggle theme
        </button>
      </div>
      <p role="status">{status}</p>
      <CameraOverlay source={source} />
      <p>
        Delegate: {stats.delegate ?? '—'} · Inference p50:{' '}
        {stats.inference.p50?.toFixed(1) ?? '—'} ms · p95:{' '}
        {stats.inference.p95?.toFixed(1) ?? '—'} ms · Frames: {stats.frames}
      </p>
      <p>Estimated from the camera — not a medical measurement.</p>
    </main>
  );
}
if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(<Preview />);
