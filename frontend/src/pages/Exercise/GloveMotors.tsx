import { GLOVE_FINGERS, type GloveTelemetry } from '../../contracts/glove';
import type { FingerId } from '../../contracts/vision';
import { useGlove, useGloveTelemetry } from '../../glove';

export type MotorState =
  | 'off'
  | 'stopped'
  | 'idle'
  | 'following'
  | 'pulling'
  | 'holding'
  | 'releasing';

const NAMES: Record<FingerId, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
};

const WORDS: Record<MotorState, string> = {
  off: 'Off',
  stopped: 'Stopped',
  idle: 'Resting',
  // In follow mode the motor pays out thread behind the finger: it never closes the hand.
  following: 'Letting go',
  pulling: 'Helping',
  holding: 'Holding',
  releasing: 'Letting go',
};

/** One motor's state from telemetry: `a` is ramped tendon pull, `tg` its pull goal. */
export function motorState(tel: GloveTelemetry | null, i: number): MotorState {
  if (!tel) return 'off';
  if (tel.st === 'fault') return 'stopped';
  const a = tel.a[i] ?? 0;
  const goal = tel.tg?.[i] ?? a;
  if (tel.md === 'target') {
    if (goal - a > 0.01) return 'pulling';
    if (a - goal > 0.01) return 'releasing';
    return a > 0.03 ? 'holding' : 'idle';
  }
  if (tel.md === 'follow') return a > 0.02 ? 'following' : 'idle';
  if (tel.md === 'none' && a > 0.03) return 'releasing';
  return 'idle';
}

/**
 * Compact strip of the five glove motors: which one is helping, holding or just following.
 * Selects a rounded signature so the 50 Hz telemetry only re-renders on visible changes.
 */
export function GloveMotors() {
  const glove = useGlove();
  const simulated = glove.client.kind === 'sim';
  const signature = useGloveTelemetry((tel) =>
    tel
      ? GLOVE_FINGERS.map(
          (_, i) => `${motorState(tel, i)}:${Math.round((tel.a[i] ?? 0) * 20)}`,
        ).join('|')
      : 'off',
  );
  const motors = GLOVE_FINGERS.map((finger, i) => {
    const [state, step] = (
      signature === 'off' ? 'off:0' : signature.split('|')[i]
    ).split(':');
    return { finger, state: state as MotorState, position: Number(step) * 5 };
  });
  const helping = motors.filter(
    (m) => m.state === 'pulling' || m.state === 'holding',
  );
  return (
    <section className="glove-motors" aria-label="Glove opening help">
      <header className="glove-motors__head">
        <h2 className="glove-motors__title">Glove opening help</h2>
        {simulated && (
          <span className="glove-motors__tag">Test mode · no motors</span>
        )}
      </header>
      {simulated && (
        <p className="glove-motors__note">
          What the glove motors would do with your hand right now.
        </p>
      )}
      <ul className="glove-motors__row">
        {motors.map((m) => (
          <li key={m.finger} className="glove-motor" data-state={m.state}>
            <span
              className="glove-motor__bar"
              role="meter"
              aria-label={`${NAMES[m.finger]} opening help`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={m.position}
              aria-valuetext={`${m.position}% opening help, ${WORDS[m.state]}`}
            >
              <span
                className="glove-motor__fill"
                style={{ blockSize: `${m.position}%` }}
              />
            </span>
            <span className="glove-motor__name">{NAMES[m.finger]}</span>
            {/* Two short lines ("20%" over "Letting go") so narrow cells never wrap to three. */}
            <span className="glove-motor__state">
              <span className="glove-motor__value">{m.position}%</span>{' '}
              <span className="glove-motor__word">{WORDS[m.state]}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {helping.length
          ? `Glove helping: ${helping.map((m) => NAMES[m.finger]).join(', ')}`
          : 'Glove not helping'}
      </p>
    </section>
  );
}
