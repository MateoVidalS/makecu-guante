import { CURRENT_FLEX_MODEL } from '../contracts/calibration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimWorld } from '../glove/sim';
import { SimVision } from './SimVision';
import { createVisionController } from './VisionProvider';
import type { CameraView } from '../contracts/calibration';
import { fingerMap } from './flex';

afterEach(() => vi.useRealTimers());
describe('view-aware shared simulated vision', () => {
  it.each(['front_upright', 'front_diagonal'] as CameraView[])(
    'runs %s with the same world, affected hand and camera-independent joints',
    async (view) => {
      vi.useFakeTimers();
      const world = createSimWorld({ seed: 42 });
      const source = new SimVision(world.vision);
      source.setCalibration({
        affected_hand: 'left',
        camera_view: view,
        flex_model: CURRENT_FLEX_MODEL,
        open_flex: fingerMap(() => 0),
        closed_flex: fingerMap(() => 270),
        pinch_open: 1,
        pinch_closed: 0.1,
      });
      await source.start({ affectedHand: 'left', view });
      await vi.advanceTimersByTimeAsync(120);
      expect(source.cameraView()).toBe(view);
      expect(source.latest()).toBe(world.vision.latest());
      expect(source.latest()).toMatchObject({
        detected: true,
        handedness: 'left',
      });
      expect(source.latest()?.closure).not.toBeNull();
      expect(source.videoElement()).toBeNull();
      // Restart in the other view while observations are still queued.
      await source.start({
        affectedHand: 'right',
        view: view === 'front_upright' ? 'front_diagonal' : 'front_upright',
      });
      expect(source.latest()).toBeNull();
      await vi.advanceTimersByTimeAsync(120);
      expect(source.latest()?.handedness).toBe('right');
      await source.start({ affectedHand: 'left' });
      expect(source.cameraView()).toBe('front_upright');
      source.stop();
      world.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('keeps the requested view through controller restarts', async () => {
    vi.useFakeTimers();
    const world = createSimWorld();
    const start = vi.spyOn(world.vision, 'start');
    const controller = createVisionController({
      initialKind: 'sim',
      simSource: world.vision,
    });
    await controller.start({ affectedHand: 'left', view: 'front_diagonal' });
    expect(controller.source).toBe(world.vision);
    expect(start).toHaveBeenLastCalledWith({
      affectedHand: 'left',
      view: 'front_diagonal',
    });
    controller.stop();
    await controller.setKind('sim');
    expect(controller.source).toBe(world.vision);
    expect(start).toHaveBeenLastCalledWith({
      affectedHand: 'left',
      view: 'front_diagonal',
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(controller.latest?.handedness).toBe('left');
    controller.stop();
    world.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
