import { beforeEach, describe, expect, it } from 'vitest';
import type { CameraCalibration } from '../contracts/calibration';
import {
  calibrationDevice,
  calibrationDeviceNotice,
  calibrationKey,
  rememberCalibrationDevice,
} from './calibrationDevice';

const camera = (thumb = 12.5): CameraCalibration => ({
  affected_hand: 'right',
  camera_view: 'front_upright',
  flex_model: 2,
  open_flex: { thumb, index: 20.1, middle: 18, ring: 22, pinky: 25 },
  closed_flex: { thumb: 80, index: 240, middle: 250, ring: 245, pinky: 230 },
  pinch_open: 0.9,
  pinch_closed: 0.2,
});

describe('calibration device', () => {
  beforeEach(() => localStorage.clear());
  it('identifies a calibration by its values, surviving a JSON round trip', () => {
    const saved = camera();
    expect(calibrationKey(JSON.parse(JSON.stringify(saved)))).toBe(
      calibrationKey(saved),
    );
    expect(calibrationKey(camera(12.5000001))).toBe(calibrationKey(saved));
    expect(calibrationKey(camera(14))).not.toBe(calibrationKey(saved));
    expect(calibrationKey({ ...saved, affected_hand: 'left' })).not.toBe(
      calibrationKey(saved),
    );
  });
  it('remembers the device of the latest saved calibration only', () => {
    expect(calibrationDevice(camera())).toBeNull();
    rememberCalibrationDevice(camera(), 'violet-glove');
    expect(calibrationDevice(camera())).toBe('violet-glove');
    expect(calibrationDevice(structuredClone(camera()))).toBe('violet-glove');
    expect(calibrationDevice(camera(30))).toBeNull(); // Another calibration.
    rememberCalibrationDevice(camera(30), 'bare-hand');
    expect(calibrationDevice(camera(30))).toBe('bare-hand');
    expect(calibrationDevice(camera())).toBeNull();
    expect(calibrationDevice(null)).toBeNull();
  });
  it('ignores damaged or unknown records', () => {
    localStorage.setItem('rehab-hub.camera.calibration-device', '{');
    expect(calibrationDevice(camera())).toBeNull();
    localStorage.setItem(
      'rehab-hub.camera.calibration-device',
      JSON.stringify({ key: calibrationKey(camera()), profile: 'violet' }),
    );
    expect(calibrationDevice(camera())).toBeNull();
    localStorage.setItem(
      'rehab-hub.camera.calibration-device',
      JSON.stringify({ key: calibrationKey(camera()), profile: 'auto' }),
    );
    expect(calibrationDevice(camera())).toBeNull();
  });
  it('asks to calibrate again only when the device on the hand changed', () => {
    expect(calibrationDeviceNotice('violet-glove', 'bare-hand')).toBe(
      'Calibrated with violet glove. Calibrate again for bare hand.',
    );
    expect(calibrationDeviceNotice('bare-hand', 'strap-device')).toBe(
      'Calibrated with bare hand. Calibrate again for strap device.',
    );
    expect(calibrationDeviceNotice('violet-glove', 'violet-glove')).toBeNull();
    // Unknown device at calibration, or Automatic not seeing the hand yet.
    expect(calibrationDeviceNotice(null, 'bare-hand')).toBeNull();
    expect(calibrationDeviceNotice('violet-glove', null)).toBeNull();
  });
});
