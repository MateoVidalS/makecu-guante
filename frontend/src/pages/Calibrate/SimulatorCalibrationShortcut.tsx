import { useState } from 'react';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
  type Calibration,
} from '../../contracts/calibration';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { Banner, Button, ButtonLink, Stack } from '../../design-system';
import { useRuntime } from '../../runtime';

/** Known ranges are a shortcut only when both sources are simulated. */
export function SimulatorCalibrationShortcut({
  onSaved,
}: {
  onSaved: (calibration: Calibration) => void;
}) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function calibrate() {
    setBusy(true);
    setError('');
    try {
      const calibration = await runtime.calibration.save({
        servo: GLOVE_FINGERS.map((finger) => ({
          finger,
          min_deg: 20,
          max_deg: 150,
        })),
        camera: {
          affected_hand: 'right',
          camera_view: CURRENT_CAMERA_VIEW,
          flex_model: CURRENT_FLEX_MODEL,
          open_flex: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
          closed_flex: {
            thumb: 100,
            index: 270,
            middle: 270,
            ring: 270,
            pinky: 270,
          },
          pinch_closed: 0.1,
          pinch_open: 1,
        },
        friction: {},
        current_limit_ma: 1500,
      });
      await runtime.calibration.sendToGlove();
      onSaved(calibration);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Banner tone="demo" title="Simulator calibration">
      <Stack gap={12} align="start">
        <p>
          Use the simulated hand's known range to practice without hardware.
        </p>
        <Button disabled={busy} loading={busy} onClick={() => void calibrate()}>
          {busy ? 'Saving simulator calibration…' : 'Calibrate simulator'}
        </Button>
        {error && <p role="alert">{error}</p>}
        {saved && (
          <p role="status">
            Simulator calibrated.{' '}
            <ButtonLink variant="quiet" to="/exercise">
              Continue to practice
            </ButtonLink>
          </p>
        )}
      </Stack>
    </Banner>
  );
}
