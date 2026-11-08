// Standalone Vite-only preview; integration pages remain owned by WP7.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Handedness, VisionSource } from '../contracts/vision';
import { createSimWorld } from '../glove/sim';
import { CameraVision } from './cameraVision';
import { SimVision } from './SimVision';
import { CameraOverlay } from './CameraOverlay';
import { POSES, type PoseId } from '../contracts/poses';
import { FINGERS } from './flex';
import {
  recordLandmarks,
  downloadLandmarks,
  type LandmarkRecording,
} from './recorder';
import {
  VisionRobustnessTracker,
  CAMERA_PLACEMENT_GUIDANCE,
} from './robustness';
import '../styles/base.css';
import '@fontsource/atkinson-hyperlegible/400.css';

function Preview() {
  const camera = useMemo(() => new CameraVision(), []),
    world = useMemo(() => createSimWorld(), []);
  const sim = useMemo(() => new SimVision(world.vision), [world]);
  const tracker = useMemo(() => new VisionRobustnessTracker(), []);
  const recorder = useRef<ReturnType<typeof recordLandmarks> | null>(null);
  const [recording, setRecording] = useState(false);
  const [clip, setClip] = useState<LandmarkRecording | null>(null);
  const [pose, setPose] = useState<PoseId>('open');
  const [glove, setGlove] =
    useState<LandmarkRecording['glove']>('bare-hand-points');
  const [robustness, setRobustness] = useState(() =>
    tracker.stats(performance.now()),
  );
  const [source, setSource] = useState<VisionSource>(camera);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState('');
  const [hand, setHand] = useState<Handedness>('right'),
    [mirror, setMirror] = useState(camera.mirrorHandedness());
  const [status, setStatus] = useState('Choose a source to begin.'),
    [stats, setStats] = useState(camera.stats());
  useEffect(() => {
    tracker.reset(performance.now());
    return source.onFrame((frame) =>
      tracker.add(frame, source === camera ? camera.diagnostics() : undefined),
    );
  }, [source, tracker, camera]);
  useEffect(() => {
    void CameraVision.devices()
      .then(setDevices)
      .catch(() => {});
    const timer = setInterval(() => {
      setStats(camera.stats());
      setRobustness(tracker.stats(performance.now()));
    }, 1000);
    return () => {
      clearInterval(timer);
      recorder.current?.stop();
      camera.stop();
      world.stop();
    };
  }, [camera, world, tracker]);
  function stop() {
    recorder.current?.stop();
    camera.stop();
    world.stop();
    tracker.reset();
    setStatus('Stopped.');
  }
  async function start(kind: 'camera' | 'sim') {
    stop();
    setClip(null);
    tracker.reset(performance.now());
    camera.stop();
    world.stop();
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
      <h1>Five-finger vision check</h1>
      <p>{CAMERA_PLACEMENT_GUIDANCE}</p>
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
            disabled={recording}
            onChange={(event) => {
              stop();
              setDeviceId(event.target.value);
            }}
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
            disabled={recording}
            onChange={(event) => {
              stop();
              setHand(event.target.value as Handedness);
            }}
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={mirror}
            disabled={recording}
            onChange={(event) => {
              setMirror(event.target.checked);
              camera.setMirrorHandedness(event.target.checked);
            }}
          />{' '}
          Invert camera hand labels
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
            stop();
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
      {source.kind === 'camera' && (
        <section aria-label="Hand detection check">
          <h2>Hand detection check</h2>
          <p>
            Hand detected: {Math.round(robustness.detectionRate * 100)}% of the
            last 5 s · Mean confidence:{' '}
            {Math.round(robustness.meanConfidence * 100)}%
          </p>
          <p>Check: {robustness.status}</p>
          {robustness.guidance.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <p>
            Finger landmark visibility estimate:{' '}
            {FINGERS.map(
              (f) =>
                `${f}: ${Math.round(robustness.perFingerVisibility[f] * 100)}%`,
            ).join(' · ')}
          </p>
          <p>
            Check the overlay by eye: hidden joints may be inferred by the
            model.
          </p>
        </section>
      )}
      <section aria-label="Record real landmarks">
        <h2>Record real hand landmarks</h2>
        <p>
          Hold each pose for 30 seconds in the placement above. Save one clip
          per pose and hand. Only landmark results are saved, including missed
          detections. No video or audio is recorded.
        </p>
        <div className="actions">
          <label>
            Pose{' '}
            <select
              value={pose}
              disabled={recording}
              onChange={(e) => setPose(e.target.value as PoseId)}
            >
              {Object.values(POSES).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hand covering{' '}
            <select
              value={glove}
              disabled={recording}
              onChange={(e) =>
                setGlove(e.target.value as LandmarkRecording['glove'])
              }
            >
              <option value="bare-hand-points">Bare hand with points</option>
              <option value="glove">Glove (legacy)</option>
              <option value="exposed-fingertips">Exposed fingertips</option>
              <option value="bare-hand">Bare hand</option>
            </select>
          </label>
          <button
            disabled={
              recording || source.kind !== 'camera' || !camera.videoElement()
            }
            onClick={() => {
              setClip(null);
              setRecording(true);
              const next = recordLandmarks(camera, {
                pose,
                affectedHand: hand,
                glove,
              });
              recorder.current = next;
              void next.finished.then((value) => {
                if (recorder.current !== next) return;
                recorder.current = null;
                setRecording(false);
                setClip(value);
              });
            }}
          >
            Record 30 seconds
          </button>
          <button
            disabled={!recording}
            onClick={() => recorder.current?.stop()}
          >
            Finish recording
          </button>
          <button
            disabled={!clip}
            onClick={() => {
              if (clip) downloadLandmarks(clip);
            }}
          >
            Download landmarks
          </button>
        </div>
        <p role="status">
          {recording
            ? 'Recording landmarks…'
            : clip
              ? `${clip.frames.length} frames captured over ${(clip.durationMs / 1000).toFixed(1)} s. Ready to download.`
              : 'Start the camera to record a pose.'}
        </p>
      </section>
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
