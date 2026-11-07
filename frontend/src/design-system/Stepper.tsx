import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';

export interface StepItem {
  id: string;
  label: ReactNode;
}

/**
 * Wizard progress (spec §4 "Stepper"): numbered steps, current bold, completed ✓ and clickable to go
 * back; future steps are not clickable. Renders an ordered list inside a <nav>.
 */
export function Stepper({
  steps,
  current,
  completed = [],
  onSelect,
  label = 'Progress',
  className,
}: {
  steps: StepItem[];
  /** id of the current step */
  current: string;
  /** ids of completed steps */
  completed?: string[];
  /** Called when a completed (or current) step is chosen. */
  onSelect?: (id: string) => void;
  label?: string;
  className?: string;
}) {
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <nav aria-label={label} className={cx('ds-stepper', className)}>
      <ol className="ds-stepper__list">
        {steps.map((step, i) => {
          const done = completed.includes(step.id);
          const isCurrent = step.id === current;
          const state = isCurrent ? 'current' : done ? 'done' : 'todo';
          const marker = (
            <span className="ds-stepper__marker" aria-hidden="true">
              {done && !isCurrent ? <Icon name="check" size="1em" /> : i + 1}
            </span>
          );
          const text = (
            <span className="ds-stepper__label">
              {step.label}
              {done && !isCurrent && <span className="sr-only"> (done)</span>}
            </span>
          );
          return (
            <li
              key={step.id}
              className={cx('ds-stepper__step', `ds-stepper__step--${state}`)}
              data-before-current={i < currentIndex || undefined}
            >
              {onSelect && (done || isCurrent) ? (
                <button
                  type="button"
                  className="ds-stepper__button"
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => onSelect(step.id)}
                >
                  {marker}
                  {text}
                </button>
              ) : (
                <span
                  className="ds-stepper__button"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {marker}
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
