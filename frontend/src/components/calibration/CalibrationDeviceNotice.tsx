import type { ReactNode } from 'react';
import { Banner } from '../../design-system';
import { useVision, useVisionFrame } from '../../vision';
import { CameraVision } from '../../vision/cameraVision';
import {
  calibrationDevice,
  calibrationDeviceNotice,
} from '../../vision/calibrationDevice';
import type { DeviceProfileId } from '../../vision/deviceProfiles';
import { useSavedCalibration } from '../../runtime/calibrationValidation';

/**
 * The device on the hand now: the fixed setting, or the profile Automatic uses
 * while it sees the hand (null while it does not, or without a real camera).
 */
export function useActiveDeviceProfile(): DeviceProfileId | null {
  const { source } = useVision();
  const camera = source instanceof CameraVision ? source : null;
  return useVisionFrame((frame) =>
    camera && (camera.deviceSetting() !== 'auto' || frame?.detected)
      ? camera.activeDeviceProfile()
      : null,
  );
}

/** "Calibrated with <device>. Calibrate again for <device>." when the device changed. */
export function CalibrationDeviceNotice({ action }: { action?: ReactNode }) {
  const calibration = useSavedCalibration();
  const active = useActiveDeviceProfile();
  const notice = calibrationDeviceNotice(
    calibrationDevice(calibration?.camera),
    active,
  );
  if (!notice) return null;
  return (
    <Banner tone="warning" icon="caution" title={notice} action={action} />
  );
}
