import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Select,
  Stack,
} from '../../design-system';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import { useTodaysPlan } from '../../progression/useTodaysPlan';
import {
  practicePlan,
  useShortPractice,
} from '../../components/common/practice';
import { useRuntime } from '../../runtime';
import { useOneMotorAtATime } from '../../runtime/power';
import {
  calibrationReadiness,
  useCalibrationStatus,
  useSavedCalibration,
} from '../../runtime/calibrationValidation';
import {
  PRACTICE_PREFLIGHT_MESSAGE,
  gloveRecalibrationPending,
  guidesReattached,
  updatePracticePreflight,
  usePracticePreflight,
  usePracticePreflightGate,
} from '../../components/common/preflight';
import {
  draftFromCalibration,
  freshDraft,
  saveDraft,
} from '../Calibrate/draft';

/** Confirmations survive navigation within this tab's visit. */
export function PracticeSafety({
  connected,
  seen,
  fault,
  missingCurrentSensor,
  connecting,
}: {
  connected: boolean;
  seen: boolean;
  fault: boolean;
  missingCurrentSensor: boolean;
  connecting: boolean;
}) {
  const runtime = useRuntime();
  // Today's plan (docs/plan/17); settings come back unchanged while it is off.
  const today = useTodaysPlan();
  const navigate = useNavigate();
  const location = useLocation();
  const preflight = usePracticePreflight();
  const { realGlove, checkPreflight } = usePracticePreflightGate();
  const calibration = useSavedCalibration();
  const recalibrationPending = gloveRecalibrationPending(
    preflight,
    calibration?.id ?? null,
  );
  const reattached = recalibrationPending
    ? 'yes'
    : preflight.guidesNotReattached
      ? 'no'
      : '';
  useEffect(() => {
    if (location.hash !== '#before-practice') return;
    const card = document.getElementById('before-practice');
    card?.focus();
    card?.scrollIntoView?.({ block: 'start' });
  }, [location.key, location.hash]);
  const calibrationStatus = useCalibrationStatus();
  const readiness = calibrationReadiness(calibrationStatus);
  const [short] = useShortPractice();
  const [oneMotor, setOneMotor] = useOneMotorAtATime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocker =
    realGlove && reattached === 'yes'
      ? 'Redo glove calibration before practice.'
      : realGlove && reattached !== 'no'
        ? 'Answer the guide question before practice.'
        : realGlove && !preflight.skinNormal
          ? 'Confirm the skin check before practice.'
          : calibrationStatus.state !== 'ok'
            ? 'Calibrate your comfortable range before practice.'
            : !connected
              ? 'Connect your glove before practice.'
              : fault
                ? 'Release the glove and check it before practice.'
                : missingCurrentSensor
                  ? 'The glove cannot help without its current sensor.'
                  : !seen
                    ? 'Keep your hand in the camera frame before practice.'
                    : null;

  async function start() {
    if (blocker || busy || connecting) return;
    if (!checkPreflight()) return;
    setBusy(true);
    setError('');
    try {
      await runtime.exercise.start(
        practicePlan(short),
        today.apply(DEFAULT_EXERCISE_SETTINGS),
      );
      navigate('/exercise');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="before-practice"
      tabIndex={-1}
      title="Before practice"
      aria-label="Practice safety checks"
    >
      <Stack gap={16}>
        {new URLSearchParams(location.search).get('preflight') ===
          'required' && <p role="status">{PRACTICE_PREFLIGHT_MESSAGE}</p>}
        {!realGlove && (
          <p className="hp-note">
            These safety checks are required with a connected real glove.
          </p>
        )}
        <Select
          label="Were the guides re-attached since the last calibration?"
          hint="Full pull is set at straight fingers. A moved anchor can over-straighten a finger."
          value={reattached}
          disabled={busy || recalibrationPending}
          onChange={(e) => {
            const answer = e.target.value;
            if (answer === 'yes') {
              const current = runtime.calibration.current;
              guidesReattached(current?.id ?? null);
              // Resume a real redo, rather than accepting the old ranges in Review.
              saveDraft({
                ...(current ? draftFromCalibration(current) : freshDraft()),
                servo: {},
                friction: {},
                step: 0,
                finger: 0,
                edited: true,
              });
              navigate('/calibrate?step=glove');
            } else
              updatePracticePreflight({ guidesNotReattached: answer === 'no' });
          }}
        >
          <option value="" disabled>
            Choose Yes or No
          </option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
        {(reattached === 'yes' || calibrationStatus.state !== 'ok') && (
          <ButtonLink
            to={reattached === 'yes' ? '/calibrate?step=glove' : readiness.href}
          >
            {reattached === 'yes'
              ? 'Redo glove calibration'
              : 'Calibrate before practice'}
          </ButtonLink>
        )}
        <Checkbox
          label="Skin under the guides and threads looks normal: no redness, marks or pain"
          hint="Recheck the skin after the session. Stop if redness, marks or pain appear."
          checked={preflight.skinNormal}
          disabled={busy || recalibrationPending}
          onChange={(e) =>
            updatePracticePreflight({ skinNormal: e.target.checked })
          }
        />
        <Checkbox
          label="One motor at a time (low-power supply)"
          hint="For a small bench supply: the glove helps one finger at a time, so help takes longer. Turn off with a 5 V / 2.5 A supply."
          checked={oneMotor}
          disabled={busy}
          onChange={(e) => setOneMotor(e.target.checked)}
        />
        <Button
          variant="primary"
          disabled={!!blocker || busy || connecting}
          aria-describedby={blocker ? 'practice-start-hint' : undefined}
          onClick={() => void start()}
        >
          Continue to practice
        </Button>
        {blocker && (
          <p id="practice-start-hint" className="hp-note">
            {blocker}
          </p>
        )}
        {error && (
          <p role="alert" className="hp-alert">
            {error}
          </p>
        )}
      </Stack>
    </Card>
  );
}
