import type { ExercisePhase } from '../../contracts/engine';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS, type PoseDef } from '../../contracts/poses';
import { useVisionFrame } from '../../vision';
import {
  FingerGauge,
  GaugeLegend,
  type GaugeState,
} from '../../components/metrics';

const LIVE: ExercisePhase[] = ['ATTEMPT', 'HOLD', 'ASSIST', 'ASSIST_HOLD'];

/** Three tall gauges (thumb, index, middle) fed by the camera at frame rate. */
export function LiveFingerMeters({
  pose,
  phase,
  activeMax = {},
  assisting = false,
  tolerance = DEFAULT_EXERCISE_SETTINGS.tolerance,
}: {
  pose: PoseDef;
  phase: ExercisePhase;
  activeMax?: Partial<Record<string, number>>;
  assisting?: boolean;
  tolerance?: number;
}) {
  const closure = useVisionFrame((f) =>
    f?.detected && f.confidence >= 0.6 ? f.closure : null,
  );
  const state: GaugeState = !LIVE.includes(phase)
    ? 'idle'
    : phase === 'HOLD' || phase === 'ASSIST_HOLD'
      ? 'reached'
      : assisting
        ? 'assist'
        : 'active';
  const scoring = LIVE.includes(phase);
  return (
    <div
      className="mx-gauges"
      role="group"
      aria-label="Finger movement estimates"
    >
      <div className="mx-gauges__row">
        {GLOVE_FINGERS.map((f) => (
          <FingerGauge
            key={f}
            finger={f}
            value={closure?.[f] ?? null}
            best={scoring ? (activeMax[f] ?? null) : null}
            target={pose.closure[f]}
            tolerance={tolerance}
            state={state}
          />
        ))}
      </div>
      <GaugeLegend />
    </div>
  );
}
