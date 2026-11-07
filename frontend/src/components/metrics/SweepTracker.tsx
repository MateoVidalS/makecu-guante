import { Icon } from '../../design-system';
import { fingerName } from './format';

/** Six steps (each finger, slow then fast): done = check, current = filling, next = ring. */
export function SweepTracker({
  fingers,
  finger,
  speed,
  progress,
}: {
  fingers: string[];
  finger: string | null;
  speed: 'slow' | 'fast' | null;
  progress: number;
}) {
  const steps = fingers.flatMap((f) =>
    (['slow', 'fast'] as const).map((s) => ({ finger: f, speed: s })),
  );
  const current = steps.findIndex(
    (s) => s.finger === finger && s.speed === (speed ?? 'slow'),
  );
  return (
    <ol className="mx-sweeps" aria-label="Evaluation steps">
      {steps.map((s, i) => {
        const state =
          current < 0
            ? 'next'
            : i < current
              ? 'done'
              : i === current
                ? 'now'
                : 'next';
        return (
          <li key={i} className="mx-sweeps__step" data-state={state}>
            <span className="mx-sweeps__bar">
              <span
                className="mx-sweeps__fill"
                style={{
                  width:
                    state === 'done'
                      ? '100%'
                      : state === 'now'
                        ? `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
                        : '0%',
                }}
              />
            </span>
            <span className="mx-sweeps__label">
              {state === 'done' && <Icon name="check" size="1em" />}
              {fingerName(s.finger)} · {s.speed}
              <span className="mx-sr">
                {state === 'done' ? ', done' : state === 'now' ? ', now' : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
