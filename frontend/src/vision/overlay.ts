import type {
  FingerId,
  Handedness,
  JointAngles,
  VisionFrame,
} from '../contracts/vision';
export type FingerState = 'idle' | 'active' | 'assist' | 'reached';
export const CHAINS: { finger: FingerId; points: number[] }[] = [
  { finger: 'thumb', points: [0, 1, 2, 3, 4] },
  { finger: 'index', points: [0, 5, 6, 7, 8] },
  { finger: 'middle', points: [0, 9, 10, 11, 12] },
  { finger: 'ring', points: [0, 13, 14, 15, 16] },
  { finger: 'pinky', points: [0, 17, 18, 19, 20] },
];
/** Palm outline as in MediaPipe's HAND_CONNECTIONS: wrist-index, knuckles, pinky-wrist. */
const PALM = [0, 5, 9, 13, 17, 0];
/** Middle and ring start at their knuckle; the palm outline closes the rest. */
const FROM_KNUCKLE: FingerId[] = ['middle', 'ring'];
export function handInsideGuide(frame: VisionFrame | null): boolean {
  return (
    !!frame?.detected &&
    !!frame.landmarks?.length &&
    frame.landmarks.every(
      ([x, y]) => x >= 0.1 && x <= 0.9 && y >= 0.1 && y <= 0.9,
    )
  );
}

/**
 * Clean landmark skeleton: thin white bones, small joint dots, no outlines.
 * Glove fingertips take their state colour when they are not idle.
 * Sizes scale with the canvas so the drawing looks the same at any resolution.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  frame: VisionFrame | null,
  state: (finger: FingerId) => FingerState = () => 'idle',
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width,
    height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!frame?.detected || !frame.landmarks) return;
  const style = getComputedStyle(canvas);
  const color = (token: string) => style.getPropertyValue(`--${token}`).trim();
  // White skeleton in both themes; it always sits on a dimmed video.
  const skeleton = color('vision-skeleton') || '#ffffff';
  const unit = Math.max(1, Math.min(width, height) / 240);
  const line = 1.25 * unit,
    dot = 2.25 * unit;
  const point = (index: number) => [
    frame.landmarks![index][0] * width,
    frame.landmarks![index][1] * height,
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = skeleton;
  ctx.lineWidth = line;
  const path = (indices: number[]) => {
    ctx.beginPath();
    indices.forEach((index, i) => {
      const [x, y] = point(index);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  for (const chain of CHAINS)
    path(
      FROM_KNUCKLE.includes(chain.finger)
        ? chain.points.slice(1)
        : chain.points,
    );
  path(PALM);
  ctx.globalAlpha = 1;
  const joint = (index: number, fill: string, radius = dot) => {
    const [x, y] = point(index);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  for (const chain of CHAINS) {
    const fingerState = state(chain.finger);
    const tip = chain.points[chain.points.length - 1];
    for (const index of chain.points.slice(1))
      joint(
        index,
        index === tip && fingerState !== 'idle'
          ? color(fingerState) || skeleton
          : skeleton,
        index === tip ? dot * 1.25 : dot,
      );
  }
  joint(0, skeleton);
}

/**
 * The simulator has no camera. To still show what the camera panel looks like,
 * project its joint angles into a palm-facing 2D skeleton (normalized image
 * coordinates, same layout as MediaPipe's 21 landmarks). Display only.
 */
const LAYOUT: Record<
  FingerId,
  { base: [number, number]; angle: number; lengths: number[] }
> = {
  thumb: { base: [0.43, 0.76], angle: -128, lengths: [0.1, 0.085, 0.07, 0.06] },
  index: { base: [0.43, 0.5], angle: -97, lengths: [0.11, 0.065, 0.05] },
  middle: { base: [0.505, 0.48], angle: -90, lengths: [0.12, 0.072, 0.054] },
  ring: { base: [0.575, 0.5], angle: -83, lengths: [0.11, 0.066, 0.05] },
  pinky: { base: [0.635, 0.545], angle: -74, lengths: [0.085, 0.05, 0.042] },
};
const WRIST: [number, number] = [0.53, 0.86];
export function simulatedLandmarks(
  joints: Record<FingerId, JointAngles>,
  handedness: Handedness | null = 'right',
): [number, number, number][] {
  const points: [number, number, number][] = [[...WRIST, 0]];
  const rad = Math.PI / 180;
  for (const finger of [
    'thumb',
    'index',
    'middle',
    'ring',
    'pinky',
  ] as FingerId[]) {
    const { base, angle, lengths } = LAYOUT[finger];
    const flex = joints[finger];
    const finite = (v: number) => (Number.isFinite(v) ? v : 0);
    if (finger === 'thumb') {
      // CMC -> MCP -> IP -> tip. Flexion swings the thumb across the palm.
      let [x, y] = [WRIST[0] - 0.06, WRIST[1] - 0.05];
      let heading = angle + finite(flex.mcp) * 0.9;
      const bends = [0, finite(flex.mcp) * 0.6, finite(flex.pip) * 0.8];
      points.push([x, y, 0]);
      for (let i = 0; i < 3; i++) {
        heading += bends[i];
        x += Math.cos(heading * rad) * lengths[i + 1];
        y += Math.sin(heading * rad) * lengths[i + 1];
        points.push([x, y, 0]);
      }
      continue;
    }
    let [x, y] = base;
    points.push([x, y, 0]);
    let cumulative = 0;
    for (let i = 0; i < 3; i++) {
      cumulative += finite([flex.mcp, flex.pip, flex.dip][i]);
      // Palm facing the camera: a flexing segment foreshortens, then folds back.
      const reach = lengths[i] * Math.cos(cumulative * rad);
      x += Math.cos(angle * rad) * reach;
      y += Math.sin(angle * rad) * reach;
      points.push([x, y, 0]);
    }
  }
  return handedness === 'left'
    ? points.map(([x, y, z]) => [1 - x, y, z])
    : points;
}
