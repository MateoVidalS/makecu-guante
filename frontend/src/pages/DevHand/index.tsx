import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CURRENT_CAMERA_VIEW,
  type CameraView,
} from '../../contracts/calibration';
import { POSES, type PoseId } from '../../contracts/poses';
import type { FingerId, Handedness } from '../../contracts/vision';
import { VirtualHand, type JointMap } from '../../hand3d';
import { FINGERS, JOINTS, jointsFromClosure } from '../../hand3d/rig';
import type { FingerState } from '../../hand3d/scene';
import {
  Button,
  Card,
  Checkbox,
  Heading,
  Inline,
  PageHeader,
  Pill,
  Select,
  Slider,
  Stack,
  Text,
} from '../../design-system';
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
// The live-only resistance stop state is not part of this gallery.
const labels: Record<Exclude<FingerState, 'stopped'>, string> = {
  idle: 'Resting',
  active: 'Moving alone',
  assist: 'Glove helping',
  reached: 'Reached',
};

export default function DevHand() {
  const [view, setView] = useState<CameraView>(CURRENT_CAMERA_VIEW);
  const [pose, setPose] = useState<PoseId>('open');
  const comparisonJoints = useMemo(() => {
    const sample = zero();
    for (const finger of FINGERS)
      for (const joint of JOINTS)
        sample[finger][joint] = POSES[pose].render[finger][joint] * 0.65;
    return sample;
  }, [pose]);
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
  const [grayscale, setGrayscale] = useState(false);
  const [compare, setCompare] = useState(false);
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
    <section className="hand-gallery" data-grayscale={grayscale}>
      <PageHeader
        title="Virtual hand gallery"
        lead="Ghost outline is the target. The solid hand is you."
      />
      <Select
        label="Camera view"
        aria-label="Camera view"
        value={view}
        onChange={(event) => setView(event.target.value as CameraView)}
      >
        <option value="front_upright">
          Upright · palm toward you · mirrored
        </option>
        <option value="front_diagonal">Legacy · palm down · diagonal</option>
      </Select>
      <Inline gap={16}>
        <Checkbox
          label="Grayscale"
          checked={grayscale}
          onChange={(event) => setGrayscale(event.target.checked)}
        />
        <Checkbox
          label="Compare states"
          checked={compare}
          onChange={(event) => setCompare(event.target.checked)}
        />
      </Inline>
      <div className="hand-pose-picker" role="group" aria-label="Target pose">
        {Object.values(POSES).map((p) => (
          <Pill
            key={p.id}
            selected={pose === p.id}
            onClick={() => setPose(p.id)}
          >
            {p.name}
          </Pill>
        ))}
      </div>
      <Stack gap={8}>
        <Heading level={2}>{POSES[pose].name}</Heading>
        <Text>{POSES[pose].instruction}</Text>
      </Stack>
      {compare && (
        <div
          className="hand-state-comparison"
          role="group"
          aria-label={`${POSES[pose].name} state comparison`}
        >
          {(Object.keys(labels) as (keyof typeof labels)[]).map((status) => (
            <Card key={status} title={labels[status]}>
              <VirtualHand
                target={POSES[pose].render}
                actual={() =>
                  status === 'reached' ? POSES[pose].render : comparisonJoints
                }
                state={() => status}
                pose={pose}
                handedness={handedness}
                view={view}
                reducedMotion={reducedMotion}
                keepTargetOnReach
              />
            </Card>
          ))}
        </div>
      )}
      <VirtualHand
        target={targetVisible ? POSES[pose].render : null}
        actual={() => (visible ? frame.current : null)}
        state={(finger) => states[finger]}
        pose={pose}
        handedness={handedness}
        view={view}
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
        <Select
          label="Affected hand"
          aria-label="Affected hand"
          value={handedness}
          onChange={(event) => setHandedness(event.target.value as Handedness)}
        >
          <option value="right">Right</option>
          <option value="left">Left</option>
        </Select>
        <Checkbox
          label="Hand visible"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        <Checkbox
          label="Show target"
          checked={targetVisible}
          onChange={(event) => setTargetVisible(event.target.checked)}
        />
        <Checkbox
          label="Reduced motion"
          checked={reducedMotion}
          onChange={(event) => setReducedMotion(event.target.checked)}
        />
        <Checkbox
          label="30 Hz stub vision"
          checked={stub}
          onChange={(event) => setStub(event.target.checked)}
        />
        <Select
          label="Theme"
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
        </Select>
        <Button
          onClick={() => {
            setStub(false);
            setJoints(POSES[pose].render);
          }}
        >
          Match target
        </Button>
        <Button
          onClick={() => {
            setStub(false);
            setJoints(zero());
          }}
        >
          Open actual hand
        </Button>
      </div>
      <div className="hand-joint-grid">
        {FINGERS.map((finger) => (
          <fieldset key={finger}>
            <legend>{names[finger]}</legend>
            {JOINTS.filter(
              (joint) => finger !== 'thumb' || joint !== 'dip',
            ).map((joint) => (
              <Slider
                key={joint}
                label={
                  finger === 'thumb' && joint === 'pip'
                    ? 'IP'
                    : joint.toUpperCase()
                }
                min={0}
                max={joint === 'mcp' ? 100 : 120}
                step={1}
                value={joints[finger][joint]}
                disabled={stub}
                format={(value) => `${value}°`}
                aria-label={`${names[finger]} ${finger === 'thumb' && joint === 'pip' ? 'IP' : joint.toUpperCase()}`}
                onValueChange={(value) => updateJoint(finger, joint, value)}
              />
            ))}
            <Select
              label="State"
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
            </Select>
          </fieldset>
        ))}
      </div>
      <details className="card">
        <summary>Camera and performance check</summary>
        <p>Run the camera with 30 Hz stub vision. Aim for 55 fps.</p>
        <Button disabled={cameraPending} onClick={() => void toggleCamera()}>
          {cameraPending
            ? 'Starting camera…'
            : camera
              ? 'Stop camera'
              : 'Start camera'}
        </Button>
        <p role="status">{cameraMessage}</p>
        <video
          ref={video}
          className="hand-camera"
          data-mirrored={view === 'front_upright'}
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
