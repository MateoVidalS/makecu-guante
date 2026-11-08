import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProfile } from '../../api/client';
import type { CameraCalibration } from '../../contracts/calibration';
import type { Handedness } from '../../contracts/vision';
import { Banner, Button, Stack } from '../../design-system';
import { useGlove } from '../../glove';
import { useRuntime } from '../../runtime';
import { enterTestMode } from '../../runtime/testMode';

/**
 * "Test without the motors": skip glove calibration, keep the real camera and the AI coach,
 * and show on screen what the motors would do.
 */
export function TestModeCard({
  hand,
  camera,
  compact = false,
}: {
  /** Affected hand; defaults to the profile, then the saved calibration. */
  hand?: Handedness;
  /** A camera capture to reuse (for example the wizard's unsaved captures). */
  camera?: CameraCalibration | null;
  compact?: boolean;
}) {
  const runtime = useRuntime();
  const { world } = useGlove();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true);
    setError('');
    try {
      const affected: Handedness =
        hand ??
        (await getProfile().catch(() => null))?.affected_hand ??
        runtime.calibration.current?.camera.affected_hand ??
        'right';
      await enterTestMode(runtime, world, { hand: affected, camera });
      navigate('/exercise');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Banner tone="demo" title="Test without the motors">
      <Stack gap={12} align="start">
        {!compact && (
          <p>
            No glove needed. Practice with your real hand, the camera and the AI
            coach; the screen shows what the motors would do.
          </p>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          loading={busy}
          onClick={() => void start()}
        >
          {busy ? 'Starting test mode…' : 'Start test mode'}
        </Button>
        {error && <p role="alert">{error}</p>}
      </Stack>
    </Banner>
  );
}
