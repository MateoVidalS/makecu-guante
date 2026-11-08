/**
 * Development benchmark page (not part of the app): renders a hand with known
 * joint angles, runs the real MediaPipe Hand Landmarker on the image and
 * exposes raw results to a Playwright driver (`mediapipe-bench.mjs`).
 *
 * The rendered hand is a smooth skin-toned capsule model built on the virtual
 * hand's rig, so it is not a photo of a person: detection rate and accuracy on
 * it are a proxy for, not a replacement of, recordings with the real glove.
 */
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  AmbientLight,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CameraView } from '../../contracts/calibration';
import type { FingerId, Handedness, JointAngles } from '../../contracts/vision';
import {
  applyJoints,
  createHandRig,
  FINGERS,
  HAND_PROPORTIONS,
} from '../../hand3d/rig';
import { jointAngles, pinchRatio } from '../flex';

type Joints = Record<FingerId, JointAngles>;
export interface BenchShot {
  joints: Joints;
  view: CameraView;
  hand: Handedness;
  /** Extra hand rotation (degrees) to model posture variation. */
  tilt?: { yaw?: number; pitch?: number; roll?: number };
  /** Per-pixel Gaussian sensor noise (0-255 scale) and a sub-pixel jitter of the camera. */
  sensorNoise?: number;
  shiftPx?: number;
  seed?: number;
  /** Video timestamp in ms (VIDEO mode); omit for IMAGE mode. */
  videoMs?: number;
}
export interface BenchResult {
  detected: boolean;
  score: number | null;
  label: string | null;
  world: [number, number, number][] | null;
  image: [number, number, number][] | null;
  /** The production flex sums (degrees) and pinch ratio computed from this result. */
  flex: Record<FingerId, number> | null;
  pinch: number | null;
  inferenceMs: number;
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(640, 480, false);
const scene = new Scene();
scene.background = new Color('#c9c3b8'); // plain wall
scene.add(new AmbientLight('#ffffff', 1.1));
const key = new DirectionalLight('#ffffff', 2.2);
key.position.set(2, 3, 6);
scene.add(key);
const fill = new DirectionalLight('#ffffff', 0.8);
fill.position.set(-4, -1, 3);
scene.add(fill);
const camera = new PerspectiveCamera(
  (2 * Math.atan(240 / 480) * 180) / Math.PI,
  640 / 480,
  0.1,
  100,
);

const skin = new MeshStandardMaterial({
  color: '#d9a07c',
  roughness: 0.75,
  metalness: 0,
});
function skinnedRig(hand: Handedness) {
  const rig = createHandRig(hand);
  const palm = new Mesh(new RoundedBoxGeometry(2.05, 2.1, 0.62, 5, 0.3), skin);
  rig.add(palm);
  const wrist = new CapsuleGeometry(0.62, 0.9, 6, 16);
  wrist.scale(1.25, 1, 0.55);
  const forearm = new Mesh(wrist, skin);
  forearm.position.y = -1.45;
  rig.add(forearm);
  for (const finger of FINGERS) {
    const d = HAND_PROPORTIONS[finger];
    d.lengths.forEach((length, i) => {
      const radius = d.radius * 1.55 * (1 - i * 0.08);
      const bone = new Mesh(
        new CapsuleGeometry(radius, Math.max(0.01, length - radius), 6, 14),
        skin,
      );
      bone.position.y = length / 2;
      rig.fingers[finger].joints[i].add(bone);
      const knuckle = new Mesh(new SphereGeometry(radius * 1.04, 14, 10), skin);
      rig.fingers[finger].joints[i].add(knuckle);
    });
  }
  return rig;
}
const rigs = { right: skinnedRig('right'), left: skinnedRig('left') };
const holder = new Group();
scene.add(holder);

function rand(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pose(shot: BenchShot) {
  holder.clear();
  const rig = rigs[shot.hand];
  applyJoints(rig, shot.joints, 1);
  holder.add(rig);
  holder.rotation.set(0, 0, 0);
  const r = shot.tilt ?? {};
  const deg = Math.PI / 180;
  holder.rotation.set(
    (r.pitch ?? 0) * deg,
    (r.yaw ?? 0) * deg,
    (r.roll ?? 0) * deg,
  );
  // Camera placement in rig units (+Y fingertips, +Z palm side; the palm is ~2 units wide).
  const center = new Vector3(0, 0.6, 0);
  const random = rand(shot.seed ?? 1);
  const shift = (shot.shiftPx ?? 0) * 0.012;
  if (shot.view === 'front_upright') {
    // Palm to the webcam, hand upright, ~12 units away (hand fills ~1/3 of the frame).
    camera.position.set(
      0.4 + (random() - 0.5) * shift,
      0.4 + (random() - 0.5) * shift,
      10,
    );
    camera.up.set(0, 1, 0);
  } else {
    // Legacy palm-down setup: front diagonal on the thumb side, above the back of the hand.
    const thumbSide = shot.hand === 'left' ? 0.55 : -0.55;
    const dir = new Vector3(thumbSide, 0.65, -0.52)
      .normalize()
      .multiplyScalar(9);
    camera.position.copy(center).add(dir);
    camera.position.x += (random() - 0.5) * shift;
    camera.up.set(0, 0, -1);
  }
  camera.lookAt(center);
  renderer.render(scene, camera);
}

/** Adds sensor noise on a 2D copy (what a webcam would deliver). */
const noisy = document.createElement('canvas');
noisy.width = 640;
noisy.height = 480;
const ctx = noisy.getContext('2d', { willReadFrequently: true })!;
function frameImage(shot: BenchShot): HTMLCanvasElement {
  ctx.drawImage(canvas, 0, 0);
  const sigma = shot.sensorNoise ?? 0;
  if (sigma > 0) {
    const random = rand((shot.seed ?? 1) * 7919);
    const img = ctx.getImageData(0, 0, 640, 480);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n =
        Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) *
        Math.cos(2 * Math.PI * random()) *
        sigma;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  return noisy;
}

let imageLandmarker: HandLandmarker | null = null;
let videoLandmarker: HandLandmarker | null = null;
async function create(runningMode: 'IMAGE' | 'VIDEO', delegate: 'GPU' | 'CPU') {
  const files = await FilesetResolver.forVisionTasks('/models/wasm');
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
    runningMode,
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
}
function toResult(
  r: HandLandmarkerResult,
  inferenceMs: number,
  view: CameraView,
): BenchResult {
  const i = r.handedness.length ? 0 : -1;
  if (i < 0)
    return {
      detected: false,
      score: null,
      label: null,
      world: null,
      image: null,
      flex: null,
      pinch: null,
      inferenceMs,
    };
  const tuples = (p: { x: number; y: number; z: number }[]) =>
    p.map((q): [number, number, number] => [q.x, q.y, q.z]);
  const world = tuples(r.worldLandmarks[i]);
  const image = tuples(r.landmarks[i]);
  const joints = jointAngles(world, view);
  const flex = Object.fromEntries(
    FINGERS.map((f) => [f, joints[f].mcp + joints[f].pip + joints[f].dip]),
  ) as Record<FingerId, number>;
  return {
    detected: true,
    flex,
    pinch: pinchRatio(image),
    score: r.handedness[i][0].score,
    label: r.handedness[i][0].categoryName,
    world,
    image,
    inferenceMs,
  };
}

async function init(delegate: 'GPU' | 'CPU' = 'CPU') {
  imageLandmarker = await create('IMAGE', delegate);
  videoLandmarker = await create('VIDEO', delegate);
  status.textContent = 'ready';
}
function shoot(shot: BenchShot): BenchResult {
  pose(shot);
  const image = frameImage(shot);
  const start = performance.now();
  const r =
    shot.videoMs === undefined
      ? imageLandmarker!.detect(image)
      : videoLandmarker!.detectForVideo(image, shot.videoMs);
  return toResult(r, performance.now() - start, shot.view);
}
async function resetVideo(delegate: 'GPU' | 'CPU' = 'CPU') {
  videoLandmarker?.close();
  videoLandmarker = await create('VIDEO', delegate);
}

declare global {
  interface Window {
    bench: {
      init: typeof init;
      shoot: typeof shoot;
      resetVideo: typeof resetVideo;
    };
  }
}
window.bench = { init, shoot, resetVideo };
status.textContent = 'loaded';
