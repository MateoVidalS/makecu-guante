import {
  usePutProgressionSettings,
  useProgressionSettings,
} from '../api/client';
import type { ProgressionChallenge } from '../contracts/progression';
import { DataSection, DataStatus } from '../components/charts';
import { Select, Switch } from '../design-system';
import { PROGRESSION } from './plan';
import { useTodaysPlan } from './useTodaysPlan';
import './progression.css';

const name = (finger: string) =>
  finger.charAt(0).toUpperCase() + finger.slice(1);
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

/** Doctor view: the therapist's switch for the adaptive plan, with a preview (docs/plan/17). */
export function AdaptivePlanSection() {
  const settings = useProgressionSettings();
  const save = usePutProgressionSettings();
  const today = useTodaysPlan({ preview: true });
  const value = settings.data;
  const plan = today.plan;
  const update = (next: {
    enabled?: boolean;
    challenge?: ProgressionChallenge;
  }) =>
    value &&
    save.mutate({
      enabled: next.enabled ?? value.enabled,
      challenge: next.challenge ?? value.challenge,
    });
  return (
    <DataSection
      title="Adaptive plan"
      className="adaptive-plan"
      description={`Starts each practice from the last ${PROGRESSION.window} opening sessions: a finger that does not reach the full opening alone gets a target a little beyond what it opens alone, and once most openings succeed alone, help is offered later. It only lowers targets or adds time to try alone. Glove speed, pull limits and safety stops never change, and the coach adjusts from there.`}
    >
      <DataStatus loading={settings.isPending} error={settings.error}>
        {value && (
          <div className="adaptive-plan__controls no-print">
            <Switch
              label="Adapt practice to recent progress"
              hint={
                value.enabled
                  ? 'On: every practice starts from today’s plan. The patient sees it on the practice screen (Customize plan) and can use the standard plan that day.'
                  : 'Off: every practice uses the standard targets.'
              }
              checked={value.enabled}
              disabled={save.isPending}
              onCheckedChange={(enabled) => update({ enabled })}
            />
            <Select
              label="Challenge"
              layout="inline"
              value={value.challenge}
              disabled={save.isPending}
              onChange={(e) =>
                update({ challenge: e.target.value as ProgressionChallenge })
              }
            >
              <option value="standard">Standard</option>
              <option value="gentle">Gentle</option>
            </Select>
          </div>
        )}
        {save.isError && (
          <p role="alert" className="footnote">
            The setting was not saved. Check the connection and try again.
          </p>
        )}
        <p className="footnote adaptive-plan__print">
          Adaptive plan: {value?.enabled ? `on, ${value.challenge}` : 'off'}.
        </p>
      </DataStatus>
      <DataStatus loading={today.loading} error={null}>
        {plan &&
          (plan.status === 'not_enough_data' ? (
            <p className="footnote">
              Not enough opening sessions yet: the plan adapts after{' '}
              {PROGRESSION.minSessions}.
            </p>
          ) : (
            <>
              <div className="data-table-wrap">
                <table className="data-table adaptive-plan__table">
                  <caption>
                    {value?.enabled ? 'Next practice' : 'Preview if turned on'}{' '}
                    · from sessions {[...plan.sessions].reverse().join(', ')}
                    {plan.is_demo && ' (demo data)'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Finger</th>
                      <th scope="col">Opens alone</th>
                      <th scope="col">Full opening alone</th>
                      <th scope="col">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.fingers.map((f) => (
                      <tr key={f.finger} title={f.reason}>
                        <th scope="row">{name(f.finger)}</th>
                        <td>{pct(f.opening_alone)}</td>
                        <td>{pct(f.reach_alone_rate)}</td>
                        <td>
                          {f.target_scale < 1 ? (
                            <strong>{pct(f.target_scale)}</strong>
                          ) : (
                            'Full'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="footnote">
                Time to try alone: {plan.attempt_reason}
              </p>
            </>
          ))}
      </DataStatus>
    </DataSection>
  );
}
