import { Card, DemoBadge, Switch } from '../design-system';
import type { TodaysPlanState } from './useTodaysPlan';
import './progression.css';

const name = (finger: string) =>
  finger.charAt(0).toUpperCase() + finger.slice(1);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Patient-facing "Today's plan" on the practice screen (docs/plan/17). Renders nothing while
 * the therapist has the adaptive plan off, so the default practice screen is unchanged.
 */
export function TodaysPlanCard({
  today,
  use,
  onUseChange,
}: {
  today: TodaysPlanState;
  use: boolean;
  onUseChange: (use: boolean) => void;
}) {
  if (!today.enabled) return null;
  const plan = today.plan;
  const lowered = plan?.fingers.filter((f) => f.target_scale < 1) ?? [];
  const longer = plan && plan.attempt_s > plan.base_attempt_s;
  return (
    <Card
      title="Today's plan"
      className="todays-plan"
      tone={plan?.is_demo ? 'demo' : 'default'}
      actions={plan?.is_demo ? <DemoBadge /> : undefined}
      description={
        plan?.changed
          ? `Set by your therapist's plan from your last ${plan.sessions.length} sessions.`
          : undefined
      }
    >
      {today.loading ? (
        <p className="muted">Checking your recent sessions…</p>
      ) : !plan ? (
        <p className="muted">
          Your recent sessions did not load. Today uses the standard plan.
        </p>
      ) : !plan.changed ? (
        <p>
          {plan.status === 'not_enough_data'
            ? 'Your plan adapts after two opening sessions. Today uses the standard plan.'
            : 'You are reaching the standard targets. Today uses the standard plan.'}
        </p>
      ) : (
        <>
          <ul className="todays-plan__list">
            {lowered.map((f) => (
              <li key={f.finger}>
                <strong>{name(f.finger)}</strong>: aim for {pct(f.target_scale)}{' '}
                open, a little more than last time
              </li>
            ))}
            {longer && (
              <li>
                <strong>More time to try alone</strong>: help is offered after{' '}
                {plan.attempt_s} s
              </li>
            )}
            {lowered.length > 0 && lowered.length < plan.fingers.length && (
              <li>Other fingers: full opening</li>
            )}
          </ul>
          <Switch
            label="Use today's plan"
            hint={
              use
                ? 'The glove still helps only when you ask, at the same gentle speed.'
                : 'Today uses the standard targets.'
            }
            checked={use}
            onCheckedChange={onUseChange}
          />
        </>
      )}
    </Card>
  );
}
