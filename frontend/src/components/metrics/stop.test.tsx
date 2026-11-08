import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AttemptResult } from '../../contracts/engine';
import { AttemptFeedbackCard, FingerGauge } from './index';
import { resistanceStop, stopPlace } from './stop';

afterEach(cleanup);

const resistance = {
  source: 'resistance',
  t_rel: 6.95,
  finger: 'index' as const,
  ma: 1037.2,
};
function attempt(over: Partial<AttemptResult> = {}): AttemptResult {
  const empty = { thumb: [], index: [], middle: [], ring: [], pinky: [] };
  return {
    pose: 'open',
    rep: 1,
    index: 0,
    started_at: '2026-11-05T10:00:00Z',
    ended_at: '2026-11-05T10:00:10Z',
    reached_active: false,
    reached_final: false,
    assisted: true,
    time_to_position_s: null,
    active_ratio: 0.4,
    fingers: (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).map(
      (finger) => ({
        finger,
        scored: true,
        target: 0,
        active_max: 0.55,
        assist_needed: 0.45,
        final: finger === 'index' ? 0.55 : 0.3,
      }),
    ),
    pinch_min: null,
    current_peak_ma: 1037,
    current_mean_ma: 600,
    safety_events: [resistance],
    interrupted: false,
    trace: { hz: 20, t: [], closure: empty, servo: empty, ma: [], phase: [] },
    ...over,
  };
}

describe('resistance stop', () => {
  it('is read from the attempt safety events', () => {
    expect(resistanceStop(attempt())).toEqual({ finger: 'index' });
    expect(resistanceStop(attempt({ safety_events: [] }))).toBeNull();
    expect(
      resistanceStop(
        attempt({
          safety_events: [{ ...resistance, source: 'load_shed' }],
        }),
      ),
    ).toBeNull();
    expect(stopPlace({ finger: null })).toBe('hand');
  });
  it('the attempt toast says the glove stopped, not that it helped', () => {
    const { container } = render(<AttemptFeedbackCard result={attempt()} />);
    expect(
      screen.getByText('Good effort. We stopped to keep your index safe.'),
    ).toBeVisible();
    expect(container.querySelector('.mx-attempt')).toHaveAttribute(
      'data-outcome',
      'stopped',
    );
    expect(container.textContent).not.toMatch(/helped with the rest|mA/);
  });
  it('a safety pause keeps its own sentence', () => {
    render(<AttemptFeedbackCard result={attempt({ interrupted: true })} />);
    expect(screen.getByText(/We paused here/)).toBeVisible();
  });
  it('the live gauge names the stopped finger without the glove part', () => {
    render(
      <FingerGauge
        finger="index"
        value={0.6}
        best={0.55}
        target={0}
        state="stopped"
      />,
    );
    const meter = screen.getByRole('meter', { name: 'Index' });
    expect(meter.closest('.mx-gauge')).toHaveAttribute(
      'data-state',
      'stopped',
    );
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      '60%, goal 0%, best on your own 55%, stopped',
    );
    expect(screen.getByText('Stopped')).toBeVisible();
    expect(meter.querySelector('.mx-fill--help')).toBeNull();
  });
});
