import type { FingerId, VisionFrame } from '../contracts/vision';
export type FingerState = 'idle' | 'active' | 'assist' | 'reached';
export const CHAINS: { finger: FingerId; points: number[] }[] = [
  { finger: 'thumb', points: [0, 1, 2, 3, 4] },
  { finger: 'index', points: [0, 5, 6, 7, 8] },
  { finger: 'middle', points: [0, 9, 10, 11, 12] },
  { finger: 'ring', points: [0, 13, 14, 15, 16] },
  { finger: 'pinky', points: [0, 17, 18, 19, 20] },
];
export function handInsideGuide(frame: VisionFrame | null): boolean {
  return (
    !!frame?.detected &&
    !!frame.landmarks?.length &&
    frame.landmarks.every(
      ([x, y]) => x >= 0.1 && x <= 0.9 && y >= 0.1 && y <= 0.9,
    )
  );
}
export function drawOverlay(
  canvas: HTMLCanvasElement,
  frame: VisionFrame | null,
  state: (finger: FingerId) => FingerState = () => 'active',
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width,
    height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!frame?.detected || !frame.landmarks) return;
  const style = getComputedStyle(canvas);
  const color = (token: string) => style.getPropertyValue(`--${token}`).trim();
  const px = (token: string) => parseFloat(color(token));
  // Spec calls for white skeletons even in dark mode; use existing light-surface and light-text tokens.
  const skeleton = color('vision-skeleton'),
    outline = color('vision-outline');
  const line = px('focus-width'),
    dot = px('space-4') * 0.75;
  const point = (index: number) => [
    frame.landmarks![index][0] * width,
    frame.landmarks![index][1] * height,
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const chain of CHAINS) {
    ctx.beginPath();
    chain.points.forEach((index, i) => {
      const [x, y] = point(index);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = outline;
    ctx.lineWidth = line * 2;
    ctx.stroke();
    ctx.strokeStyle = skeleton;
    ctx.lineWidth = line;
    ctx.stroke();
    const fingerState = state(chain.finger);
    for (const index of chain.points.slice(1)) {
      const [x, y] = point(index);
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fillStyle =
        fingerState === 'idle' ? color('target') : color(fingerState);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = line / 2;
      ctx.stroke();
    }
  }
  const [x, y] = point(0);
  ctx.beginPath();
  ctx.arc(x, y, dot, 0, Math.PI * 2);
  ctx.fillStyle = skeleton;
  ctx.fill();
}
