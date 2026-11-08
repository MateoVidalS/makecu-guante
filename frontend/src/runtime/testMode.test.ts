import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASSIST_DIRECTION,
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type CameraCalibration,
} from '../contracts/calibration';
import { GLOVE_FINGERS } from '../contracts/glove';
import {
  enterTestMode,
  reusableCamera,
  standardCamera,
  TEST_SERVO_RANGE,
} from './testMode';

const captured: CameraCalibration = {
  ...standardCamera('left'),
  open_flex: { thumb: 12, index: 20, middle: 18, ring: 22, pinky: 25 },
  closed_flex: { thumb: 95, index: 230, middle: 240, ring: 235, pinky: 220 },
};

function fakeRuntime(glove: 'serial' | 'sim', camera?: CameraCalibration) {
  const runtime = {
    sources: {
      glove,
      setGlove: vi.fn(async (kind: 'serial' | 'sim') => {
        runtime.sources.glove = kind;
      }),
    },
    calibration: {
      current: camera ? { camera } : null,
      save: vi.fn(async (value) => ({ id: 1, created_at: 'now', ...value })),
      sendToGlove: vi.fn(async () => {}),
    },
  };
  return runtime;
}

describe('test mode', () => {
  it('switches a real glove to the simulator, calms the simulated patient and saves a usable calibration', async () => {
    const runtime = fakeRuntime('serial');
    const world = { controls: { setPreset: vi.fn() } };
    const result = await enterTestMode(runtime as never, world as never, {
      hand: 'right',
    });
    expect(runtime.sources.setGlove).toHaveBeenCalledWith('sim');
    expect(world.controls.setPreset).toHaveBeenCalledWith('demo');
    const saved = runtime.calibration.save.mock.calls[0][0];
    expect(saved.assist_direction).toBe(CURRENT_ASSIST_DIRECTION);
    expect(saved.servo).toEqual(
      GLOVE_FINGERS.map((finger) => ({ finger, ...TEST_SERVO_RANGE })),
    );
    expect(saved.camera).toEqual(standardCamera('right'));
    expect(runtime.calibration.sendToGlove).toHaveBeenCalled();
    expect(result.cameraReused).toBe(false);
  });

  it('reuses a real camera capture for the same hand', async () => {
    const runtime = fakeRuntime('sim', captured);
    const result = await enterTestMode(runtime as never, undefined, {
      hand: 'left',
    });
    expect(runtime.sources.setGlove).not.toHaveBeenCalled();
    expect(runtime.calibration.save.mock.calls[0][0].camera).toBe(captured);
    expect(result.cameraReused).toBe(true);
  });

  it('ignores captures for another hand or an old camera view', () => {
    expect(reusableCamera(captured, 'right')).toBeNull();
    expect(
      reusableCamera({ ...captured, camera_view: 'front_diagonal' }, 'left'),
    ).toBeNull();
    expect(captured.flex_model).toBe(CURRENT_FLEX_MODEL);
    expect(captured.camera_view).toBe(CURRENT_CAMERA_VIEW);
    expect(reusableCamera(captured, 'left')).toBe(captured);
  });
});
