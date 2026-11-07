import { useEffect, useRef, useState } from 'react';
import { POSES, type PoseId } from '../../contracts/poses';
import type { FingerId, Handedness } from '../../contracts/vision';
import { VirtualHand, type JointMap } from '../../hand3d';
import { FINGERS, JOINTS, jointsFromClosure } from '../../hand3d/rig';
import type { FingerState } from '../../hand3d/scene';
import './gallery.css';

const zero = () =>
  jointsFromClosure({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 });
const names: Record<FingerId, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
};
const labels: Record<FingerState, string> = {
  idle: 'Resting',
  active: 'Moving alone',
  assist: 'Glove helping',
  reached: 'Reached',
};

export default function DevHand() {
  const [pose, setPose] = useState<PoseId>('open');
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [joints, setJoints] = useState<JointMap>(zero);
  const [states, setStates] = useState<Record<FingerId, FingerState>>({
    thumb: 'idle',
    index: 'active',
    middle: 'assist',
    ring: 'idle',
    pinky: 'idle',
  });
  const [visible, setVisible] = useState(true);
  const [targetVisible, setTargetVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [stub, setStub] = useState(false);
  const [fps, setFps] = useState(0);
  const [camera, setCamera] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const pendingCapture = useRef(false);
  const [cameraMessage, setCameraMessage] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const frame = useRef(joints);
  const stubFrame = useRef(zero());
  const frameCount = useRef(0);
  const frameCountOutput = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (!stub) {
      frame.current = joints;
      return;
    }
    const start = performance.now();
    const timer = window.setInterval(() => {
      const amount = (Math.sin((performance.now() - start) / 1600) + 1) / 2;
      for (const finger of FINGERS) {
        const full =
          finger === 'thumb'
            ? POSES.full_fist.render.thumb
            : POSES.full_fist.render[finger];
        for (const joint of JOINTS)
          stubFrame.current[finger][joint] = full[joint] * amount;
      }
      frame.current = stubFrame.current;
      frameCount.current++;
      if (frameCountOutput.current)
        frameCountOutput.current.value = String(frameCount.current);
    }, 1000 / 30);
    return () => window.clearInterval(timer);
  }, [stub, joints]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleCamera() {
    if (pendingCapture.current) return;
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (video.current) video.current.srcObject = null;
      setCamera(false);
      setCameraMessage('Camera stopped.');
      return;
    }
    pendingCapture.current = true;
    setCameraPending(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: false,
      });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (!mounted.current) return;
      setCamera(true);
      setCameraMessage(
        'Camera running locally. Joint input still comes from the gallery.',
      );
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (mounted.current) {
        setCamera(false);
        setCameraMessage(
          'Camera unavailable. Allow camera access to run this check.',
        );
      }
    } finally {
      pendingCapture.current = false;
      if (mounted.current) setCameraPending(false);
    }
  }

  function updateJoint(
    finger: FingerId,
    joint: (typeof JOINTS)[number],
    value: number,
  ) {
    setJoints((current) => ({
      ...current,
      [finger]: { ...current[finger], [joint]: value },
    }));
  }
  return (
    <section className="hand-gallery">
      <h1>Virtual hand gallery</h1>
      <p>Ghost outline is the target. The solid hand is you.</p>
      <div className="hand-pose-picker" role="group" aria-label="Target pose">
        {Object.values(POSES).map((p) => (
          <button
            key={p.id}
            aria-pressed={pose === p.id}
            onClick={() => setPose(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <h2>{POSES[pose].name}</h2>
      <p>{POSES[pose].instruction}</p>
      <VirtualHand
        target={targetVisible ? POSES[pose].render : null}
        actual={() => (visible ? frame.current : null)}
        state={(finger) => states[finger]}
        pose={pose}
        handedness={handedness}
        reducedMotion={reducedMotion}
        onFps={setFps}
      />
      <p className="hand-diagnostics">
        <output aria-label="Frames per second" data-testid="hand-fps">
          {fps.toFixed(1)}
        </output>{' '}
        fps ·{' '}
        <span>
          Stub frames:{' '}
          <output ref={frameCountOutput} aria-label="Stub frames">
            0
          </output>
        </span>
      </p>
      <div className="hand-gallery-options">
        <label>
          Affected hand{' '}
          <select
            aria-label="Affected hand"
            value={handedness}
            onChange={(event) =>
              setHandedness(event.target.value as Handedness)
            }
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          Hand visible
        </label>
        <label>
          <input
            type="checkbox"
            checked={targetVisible}
            onChange={(event) => setTargetVisible(event.target.checked)}
          />
          Show target
        </label>
        <label>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)}
          />
          Reduced motion
        </label>
        <label>
          <input
            type="checkbox"
            checked={stub}
            onChange={(event) => setStub(event.target.checked)}
          />
          30 Hz stub vision
        </label>
        <label>
          Theme{' '}
          <select
            aria-label="Theme"
            defaultValue="system"
            onChange={(event) => {
              if (event.target.value === 'system')
                delete document.documentElement.dataset.theme;
              else document.documentElement.dataset.theme = event.target.value;
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <button
          onClick={() => {
            setStub(false);
            setJoints(POSES[pose].render);
          }}
        >
          Match target
        </button>
        <button
          onClick={() => {
            setStub(false);
            setJoints(zero());
          }}
        >
          Open actual hand
        </button>
      </div>
      <div className="hand-joint-grid">
        {FINGERS.map((finger) => (
          <fieldset key={finger}>
            <legend>{names[finger]}</legend>
            {JOINTS.filter(
              (joint) => finger !== 'thumb' || joint !== 'dip',
            ).map((joint) => (
              <label key={joint}>
                {finger === 'thumb' && joint === 'pip'
                  ? 'IP'
                  : joint.toUpperCase()}{' '}
                <output>{joints[finger][joint]}°</output>
                <input
                  type="range"
                  min={0}
                  max={joint === 'mcp' ? 100 : 120}
                  step={1}
                  value={joints[finger][joint]}
                  disabled={stub}
                  aria-label={`${names[finger]} ${finger === 'thumb' && joint === 'pip' ? 'IP' : joint.toUpperCase()}`}
                  onChange={(event) =>
                    updateJoint(finger, joint, Number(event.target.value))
                  }
                />
              </label>
            ))}
            <label>
              State{' '}
              <select
                aria-label={`${names[finger]} state`}
                value={states[finger]}
                onChange={(event) =>
                  setStates((current) => ({
                    ...current,
                    [finger]: event.target.value as FingerState,
                  }))
                }
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
      </div>
      <details className="card">
        <summary>Camera and performance check</summary>
        <p>Run the camera with 30 Hz stub vision. Aim for 55 fps.</p>
        <button disabled={cameraPending} onClick={() => void toggleCamera()}>
          {cameraPending
            ? 'Starting camera…'
            : camera
              ? 'Stop camera'
              : 'Start camera'}
        </button>
        <p role="status">{cameraMessage}</p>
        <video
          ref={video}
          className="hand-camera"
          muted
          autoPlay
          playsInline
          aria-label="Performance camera preview"
        />
        <p className="muted">
          Estimated from the camera — not a medical measurement.
        </p>
      </details>
    </section>
  );
}
