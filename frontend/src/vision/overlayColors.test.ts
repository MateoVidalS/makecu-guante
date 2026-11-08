import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisionFrame } from '../contracts/vision';
import { drawOverlay } from './overlay';

const GREEN = '#3e9468';
const WHITE = '#ffffff';

function canvasRecordingFills() {
  const fills: string[] = [];
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fillStyle: '',
    fill() {
      fills.push(this.fillStyle);
    },
  };
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  vi.spyOn(canvas, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) =>
      ({ '--vision-skeleton': WHITE, '--reached': GREEN })[name] ?? '',
  } as CSSStyleDeclaration);
  return { canvas, fills };
}

function frame(closure: VisionFrame['closure']): VisionFrame {
  return {
    t: 0,
    detected: true,
    confidence: 0.95,
    handedness: 'right',
    closure,
    rawFlexSum: null,
    joints: null,
    pinch: null,
    landmarks: Array.from({ length: 21 }, (_, i) => [
      0.3 + i * 0.01,
      0.3 + i * 0.01,
      0,
    ]) as [number, number, number][],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('camera overlay points', () => {
  it('are white before the camera is calibrated', () => {
    const { canvas, fills } = canvasRecordingFills();
    drawOverlay(canvas, frame(null));
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set([WHITE]));
  });

  it('turn green once the camera is calibrated', () => {
    const { canvas, fills } = canvasRecordingFills();
    drawOverlay(
      canvas,
      frame({ thumb: 0.1, index: 0.2, middle: 0.3, ring: 0.4, pinky: 0.5 }),
    );
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set([GREEN]));
  });
});
