import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type {
  VisionFrame,
  VisionSource,
  Handedness,
} from '../contracts/vision';
import type { CameraCalibration } from '../contracts/calibration';
import {
  createVisionController,
  useVision,
  useVisionFrame,
  VisionProvider,
} from './VisionProvider';
import { CameraOverlay } from './CameraOverlay';
import { drawOverlay, handInsideGuide } from './overlay';
import { missingFrame } from './frameProcessor';
import { fingerMap } from './flex';
import { GloveProvider, useGlove } from '../glove';

class TestSource implements VisionSource {
  frame: VisionFrame | null = null;
  listeners = new Set<(frame: VisionFrame) => void>();
  video: HTMLVideoElement | null = null;
  constructor(readonly kind: 'camera' | 'sim') {}
  start = vi.fn(
    async (_options: { affectedHand: Handedness; deviceId?: string }) => {},
  );
  stop = vi.fn(() => {
    this.emit(missingFrame(0));
  });
  setCalibration = vi.fn((_c: CameraCalibration | null) => {});
  onFrame(cb: (frame: VisionFrame) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  latest() {
    return this.frame;
  }
  videoElement() {
    return this.video;
  }
  emit(frame: VisionFrame) {
    this.frame = frame;
    this.listeners.forEach((cb) => cb(frame));
  }
}
const visible = (): VisionFrame => ({
  ...missingFrame(10),
  detected: true,
  confidence: 0.95,
  closure: fingerMap(() => 0.5),
  landmarks: Array.from({ length: 21 }, () => [0.5, 0.5, 0]),
});
const context = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('vision source controller', () => {
  it('disposes the standalone simulator clock without leaking timers', async () => {
    vi.useFakeTimers();
    const controller = createVisionController({ initialKind: 'sim' });
    await controller.start();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(120);
    expect(controller.latest?.detected).toBe(true);
    controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the same simulator world as the enclosing glove provider', async () => {
    vi.useFakeTimers();
    let shared = false;
    function Probe() {
      shared = useVision().source === useGlove().world.vision;
      return null;
    }
    const view = render(
      <GloveProvider>
        <VisionProvider initialKind="sim">
          <Probe />
        </VisionProvider>
      </GloveProvider>,
    );
    await act(async () => {});
    expect(shared).toBe(true);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('switches sources, forwards persistent subscriptions and settings, and removes old listeners', async () => {
    const sim = new TestSource('sim'),
      camera = new TestSource('camera');
    const controller = createVisionController({
      simSource: sim,
      cameraSource: camera,
      initialKind: 'sim',
    });
    await controller.start({ affectedHand: 'left', deviceId: 'preferred' });
    const listener = vi.fn(),
      unsubscribe = controller.subscribe(listener);
    sim.emit(visible());
    expect(controller.latest?.detected).toBe(true);
    await controller.setKind('camera');
    expect(sim.stop).toHaveBeenCalled();
    expect(sim.listeners.size).toBe(0);
    expect(camera.start).toHaveBeenCalledWith({
      affectedHand: 'left',
      deviceId: 'preferred',
    });
    expect(controller.latest).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detected: false, closure: null }),
    );
    camera.emit(visible());
    expect(listener).toHaveBeenCalledTimes(3);
    sim.emit(visible());
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    controller.stop();
    expect(camera.listeners.size).toBe(0);
    expect(controller.latest).toBeNull();
  });
  it('exposes start failures, preserves calibration on switches, and supports restarting after cleanup', async () => {
    const sim = new TestSource('sim'),
      camera = new TestSource('camera');
    const controller = createVisionController({
      simSource: sim,
      cameraSource: camera,
      initialKind: 'sim',
    });
    const calibration: CameraCalibration = {
      affected_hand: 'left',
      open_flex: fingerMap(() => 0),
      closed_flex: fingerMap(() => 180),
      pinch_open: 1,
      pinch_closed: 0.1,
    };
    controller.setCalibration(calibration);
    camera.start.mockRejectedValueOnce(new Error('Camera permission denied'));
    await expect(controller.setKind('camera')).rejects.toThrow(
      'Camera permission denied',
    );
    expect(controller.error).toBe('Camera permission denied');
    expect(controller.latest).toBeNull();
    await controller.start();
    expect(controller.error).toBeNull();
    expect(camera.setCalibration).toHaveBeenLastCalledWith(calibration);
    expect(camera.start).toHaveBeenLastCalledWith({ affectedHand: 'left' });
    controller.stop();
    await controller.start();
    expect(camera.listeners.size).toBe(1);
    controller.stop();
  });
  it('keeps React selectors current and cleans up the provider on unmount', async () => {
    const sim = new TestSource('sim');
    function Probe() {
      const vision = useVision(),
        detected = useVisionFrame((f) => f?.detected ?? false);
      return (
        <output>
          {vision.source.kind}:{String(detected)}
        </output>
      );
    }
    const view = render(
      <VisionProvider simSource={sim} initialKind="sim">
        <Probe />
      </VisionProvider>,
    );
    await act(async () => {});
    expect(screen.getByText('sim:false')).toBeDefined();
    act(() => sim.emit(visible()));
    expect(screen.getByText('sim:true')).toBeDefined();
    view.unmount();
    expect(sim.listeners.size).toBe(0);
    expect(sim.stop).toHaveBeenCalled();
  });
});

describe('camera overlay', () => {
  it('renders percentages, unknown values, confidence and loss copy without a provider', () => {
    const source = new TestSource('camera');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context() as unknown as CanvasRenderingContext2D,
    );
    const view = render(<CameraOverlay source={source} compact />);
    expect(screen.getByText('Hand not visible')).toBeDefined();
    act(() => source.emit(visible()));
    expect(screen.getByText('Sees hand 95%')).toBeDefined();
    expect(screen.getAllByText('50%')).toHaveLength(5);
    act(() => source.emit({ ...visible(), closure: null }));
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(
      screen.getByText('Calibrate to see finger percentages.'),
    ).toBeDefined();
    act(() => source.emit(missingFrame(20)));
    expect(screen.getByText('Move your hand into the frame.')).toBeDefined();
    view.unmount();
    expect(source.listeners.size).toBe(0);
  });
  it('attaches the actual camera video, supports display mirroring, and removes the video on cleanup', () => {
    const source = new TestSource('camera');
    source.video = document.createElement('video');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const view = render(<CameraOverlay source={source} mirrored />);
    expect(
      source.video.parentElement?.classList.contains(
        'camera-overlay__preview--mirrored',
      ),
    ).toBe(true);
    view.unmount();
    expect(source.video.parentElement).toBeNull();
  });
  it('clears stale drawings, draws 21 joints and checks all landmarks against the guide', () => {
    const canvas = document.createElement('canvas'),
      ctx = context();
    canvas.style.setProperty('--space-4', '4px');
    canvas.style.setProperty('--focus-width', '3px');
    vi.spyOn(canvas, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    drawOverlay(canvas, visible());
    expect(ctx.arc).toHaveBeenCalledTimes(21);
    drawOverlay(canvas, missingFrame(20));
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(handInsideGuide(visible())).toBe(true);
    const edge = visible();
    edge.landmarks![0] = [0.01, 0.5, 0];
    expect(handInsideGuide(edge)).toBe(false);
    expect(handInsideGuide(missingFrame(20))).toBe(false);
  });
  it('updates the overlay when the provider switches from camera to simulator', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const sim = new TestSource('sim');
    function Switcher() {
      const vision = useVision();
      return (
        <button
          onClick={() => {
            void vision.setKind('sim');
          }}
        >
          Simulator
        </button>
      );
    }
    render(
      <VisionProvider simSource={sim} initialKind="camera">
        <CameraOverlay />
        <Switcher />
      </VisionProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Simulator'));
    });
    expect(screen.getByText('Simulated camera')).toBeDefined();
    act(() => sim.emit(visible()));
    expect(screen.getByText('Sees hand 95%')).toBeDefined();
  });
});
