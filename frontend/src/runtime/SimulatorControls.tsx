import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGlove } from '../glove';
import { useVision } from '../vision';
import { GLOVE_FINGERS, type GloveFinger } from '../contracts/glove';
import { useRuntime } from './RuntimeProvider';
import type { PatientPreset } from '../glove/sim/patient';
import { Button, Checkbox, Select, Stack } from '../design-system';
import './fallback.css';

/** Simulator-only controls for the resistance demo; no hardware commands. */
export function RuntimeSimulatorControls() {
  const { world, client } = useGlove();
  const vision = useVision();
  const [, refresh] = useState(0);
  const [rigidFinger, setRigidFinger] = useState<GloveFinger>('index');
  if (client.kind !== 'sim') return null;
  return (
    <Stack gap={8}>
      <Select
        label="Patient preset"
        value={world.patient.preset}
        onChange={(event) => {
          world.controls.setPreset(event.target.value as PatientPreset);
          refresh((value) => value + 1);
        }}
      >
        <option value="mild">Mild</option>
        <option value="moderate">Moderate</option>
        <option value="severe">Severe</option>
      </Select>
      {vision.source.kind === 'sim' && (
        <Button onClick={() => world.controls.handOutOfFrame(3000)}>
          Hide simulated hand for 3 seconds
        </Button>
      )}
      <Button variant="danger" onClick={() => world.controls.pressStop()}>
        Press simulated STOP
      </Button>
      <Button onClick={() => world.controls.releaseStop()}>
        Release simulated STOP
      </Button>
      <Button onClick={() => world.controls.unplug()}>
        Unplug simulated glove
      </Button>
      <Select
        label="Rigid finger"
        value={rigidFinger}
        onChange={(event) => setRigidFinger(event.target.value as GloveFinger)}
      >
        {GLOVE_FINGERS.map((finger) => (
          <option key={finger} value={finger}>
            {finger}
            {world.patient.rigid[finger] ? ' (rigid)' : ''}
          </option>
        ))}
      </Select>
      <Checkbox
        label={`Rigid ${rigidFinger}`}
        checked={world.patient.rigid[rigidFinger]}
        onChange={(event) => {
          world.controls.setRigid(rigidFinger, event.target.checked);
          refresh((value) => value + 1);
        }}
      />
    </Stack>
  );
}

/** Known model ranges belong only to a fully simulated glove and camera. */
export function RuntimeSimulatorCalibration() {
  const glove = useGlove(),
    vision = useVision(),
    runtime = useRuntime();
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState('');
  if (glove.client.kind !== 'sim' || vision.source.kind !== 'sim') return null;
  return (
    <section className="card">
      <h2>Simulator calibration</h2>
      <p>Use the simulated hand's known range to practice without hardware.</p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void runtime.calibration
            .save({
              servo: GLOVE_FINGERS.map((finger) => ({
                finger,
                min_deg: 20,
                max_deg: 150,
              })),
              camera: {
                affected_hand: 'right',
                open_flex: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
                closed_flex: {
                  thumb: 100,
                  index: 270,
                  middle: 270,
                  ring: 270,
                  pinky: 270,
                },
                pinch_open: 1,
                pinch_closed: 0.1,
              },
              friction: {},
              current_limit_ma: 1500,
            })
            .then(() => setSaved(true))
            .catch((e: unknown) =>
              setError(
                e instanceof Error ? e.message : 'Could not save calibration',
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Saving simulator calibration…' : 'Calibrate simulator'}
      </button>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <p role="status">
          Simulator calibrated. <Link to="/exercise">Continue to practice</Link>
        </p>
      )}
    </section>
  );
}
