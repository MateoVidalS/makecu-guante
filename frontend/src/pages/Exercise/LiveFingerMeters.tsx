import type { ExercisePhase } from '../../contracts/engine';
import { GLOVE_FINGERS } from '../../contracts/glove';
import { DEFAULT_EXERCISE_SETTINGS, type PoseDef } from '../../contracts/poses';
import { useVisionFrame } from '../../vision';
import { FingerGauge, GaugeLegend } from '../../components/metrics';

import { useRuntime } from '../../runtime';
import type { Runtime } from '../../contracts/runtime';
import { useHighlightedFinger } from '../../components/therapy/useHighlightedFinger';
import { liveFingerState } from './fingerState';
import { stopFor } from './attemptStatus';
import type { ResistanceStop } from '../../components/metrics/stop';

const LIVE: ExercisePhase[] = ['ATTEMPT', 'HOLD', 'ASSIST', 'ASSIST_HOLD'];

/** Five tall gauges in glove wire order fed by the camera at frame rate. */
export function LiveFingerMeters({
  pose,
  phase,
  activeMax = {},
  assisting: helping = false,
  stop = null,
  tolerance = DEFAULT_EXERCISE_SETTINGS.tolerance,
}: {
  pose: PoseDef;
  phase: ExercisePhase;
  activeMax?: Partial<Record<string, number>>;
  assisting?: boolean;
  /** This attempt's live resistance stop: mark that finger, nothing is helping now. */
  stop?: ResistanceStop | null;
  tolerance?: number;
}) {
  const assisting = helping && !stop;
  const therapy = (useRuntime() as Runtime).therapy;
  const highlighted = useHighlightedFinger(therapy);
  const live = therapy?.state();
  const closure = useVisionFrame((f) =>
    f?.detected && f.confidence >= 0.6 ? f.closure : null,
  );
  const scoring = LIVE.includes(phase);
  return (
    <div
      className="mx-gauges"
      role="group"
      aria-label="Finger movement estimates"
    >
      <div className="mx-gauges__row">
        {GLOVE_FINGERS.map((f) => {
          // Follow the runtime's shaped goal; null still means a free finger.
          const runtimeFinger =
            live?.pose === pose.id
              ? live.fingers.find((finger) => finger.finger === f)
              : undefined;
          const target = runtimeFinger ? runtimeFinger.target : pose.closure[f];
          return (
            <FingerGauge
              key={f}
              finger={f}
              highlighted={highlighted === f}
              value={closure?.[f] ?? null}
              best={scoring ? (activeMax[f] ?? null) : null}
              target={target}
              tolerance={tolerance}
              assisting={scoring && assisting}
              state={liveFingerState({
                phase,
                target,
                value: closure?.[f] ?? null,
                best: activeMax[f] ?? null,
                assisting,
                stop: stopFor(stop, f),
                tolerance,
              })}
            />
          );
        })}
      </div>
      <GaugeLegend />
    </div>
  );
}
