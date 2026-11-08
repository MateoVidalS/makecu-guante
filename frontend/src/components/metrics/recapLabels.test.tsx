import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AttemptResult, SessionSummary } from '../../contracts/engine';
import {
  AttemptFeedbackCard,
  AttemptStrip,
  SplitBars,
  attemptOutcome,
  attemptSentence,
  recapCounts,
  recapCountsText,
  recapSentence,
} from './index';

afterEach(cleanup);

// EX-06: the glove is credited only for help it gave, and "reached" only when reached_final.
const resistance = {
  source: 'resistance',
  t_rel: 6.95,
  finger: 'index' as const,
  ma: 1037,
};
function attempt(over: Partial<AttemptResult> = {}): AttemptResult {
  return {
    pose: 'open',
    rep: 1,
    index: 0,
    started_at: '2026-11-05T10:00:00Z',
    ended_at: '2026-11-05T10:00:10Z',
    reached_active: false,
    reached_final: false,
    assisted: false,
    time_to_position_s: null,
    active_ratio: 0.4,
    fingers: [
      {
        finger: 'index',
        scored: true,
        target: 0,
        active_max: 0.6,
        assist_needed: 0.6,
        final: 0.6,
      },
    ],
    pinch_min: null,
    current_peak_ma: null,
    current_mean_ma: null,
    safety_events: [],
    interrupted: false,
    trace: {
      hz: 20,
      t: [],
      closure: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
      servo: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
      ma: [],
      phase: [],
    },
    ...over,
  };
}
const own = attempt({ reached_active: true, reached_final: true });
const helped = attempt({ assisted: true, reached_final: true });
const partial = attempt({ assisted: true });
const resisted = attempt({ assisted: true, safety_events: [resistance] });
const ended = attempt({ interrupted: true });
function summaryOf(list: AttemptResult[]): SessionSummary {
  return {
    attempts: list.length,
    reached_active: list.filter((a) => a.reached_active).length,
    assisted: list.filter((a) => a.assisted).length,
    interrupted: list.filter((a) => a.interrupted).length,
    active_ratio_mean: 0.4,
    per_pose: [],
    per_finger: [],
    previous: null,
  };
}

describe('attempt outcome labels', () => {
  it('says "reached with the glove" only when the pose was reached', () => {
    expect(attemptOutcome(own)).toBe('own');
    expect(attemptOutcome(helped)).toBe('helped');
    expect(attemptOutcome(partial)).toBe('partial');
    expect(attemptOutcome(resisted)).toBe('partial');
    expect(attemptOutcome(attempt())).toBe('tried');
  });
  it('labels interrupted attempts as such, even when the glove had started', () => {
    expect(attemptOutcome(ended)).toBe('paused');
    expect(
      attemptOutcome({ ...ended, assisted: true, reached_final: true }),
    ).toBe('paused');
  });
  it('reads a resistance stop as a calm stop, not a success', () => {
    expect(attemptSentence(resisted)).toBe(
      'Good effort. The glove felt resistance and eased off.',
    );
    expect(attemptSentence(partial)).toBe(
      'Good effort. The glove went part of the way.',
    );
    expect(attemptSentence(helped)).toBe(
      'Good effort. The glove helped with the rest.',
    );
    for (const a of [partial, resisted])
      expect(attemptSentence(a)).not.toMatch(/helped|reached|did it/i);
  });
});

describe('recap counts and sentence', () => {
  it('case A: only interrupted attempts never credit the glove', () => {
    const list = [ended, { ...ended, index: 1 }, { ...ended, index: 2 }];
    const counts = recapCounts(summaryOf(list), list);
    expect(recapCountsText(counts)).toBe(
      '3 attempts · 0 on your own · 0 with help · 3 ended early',
    );
    const sentence = recapSentence(summaryOf(list), list);
    expect(sentence).toBe('Short session today. Rest, then try again later.');
    expect(sentence).not.toMatch(/glove/i);
  });
  it('case B: an assisted attempt stopped by resistance is not "helped"', () => {
    const counts = recapCounts(summaryOf([resisted]), [resisted]);
    expect(counts).toMatchObject({ helped: 0, partial: 1, resisted: 1 });
    expect(recapCountsText(counts)).toBe(
      '1 attempt · 0 on your own · 0 with help · 1 part way',
    );
    expect(recapSentence(summaryOf([resisted]), [resisted])).toBe(
      'Good effort today. The glove eased off when it felt resistance.',
    );
  });
  it('credits the glove when it helped a pose to completion', () => {
    const list = [helped, { ...partial, index: 1 }];
    expect(recapSentence(summaryOf(list), list)).toBe(
      'Good effort today. The glove helped where needed.',
    );
    expect(recapSentence(summaryOf([partial]), [partial])).toBe(
      'Good effort today. The glove went part of the way.',
    );
    expect(recapSentence(summaryOf([attempt()]), [attempt()])).toBe(
      'Good effort today. Every try counts.',
    );
    expect(recapSentence(summaryOf([own]), [own])).toBe(
      'You reached most poses on your own. Steady work.',
    );
  });
  it('without the attempt list, says only that the glove took part', () => {
    const summary = summaryOf([own, helped, partial, ended]);
    const counts = recapCounts(summary);
    expect(recapCountsText(counts)).toBe(
      '4 attempts · 1 on your own · 2 with the glove · 1 ended early',
    );
    expect(recapSentence(summary)).toBe('Good effort today. Every try counts.');
  });
});

describe('recap components', () => {
  it('attempt strip names partial and ended attempts, with the resistance note', () => {
    render(
      <AttemptStrip
        attempts={[
          { group: 'Open hand', outcome: 'partial', note: 'It eased off' },
          { group: 'Open hand', outcome: 'paused' },
        ]}
      />,
    );
    expect(
      screen.getByText('Attempt 1: Part way with the glove. It eased off'),
    ).toBeTruthy();
    expect(screen.getByText('Attempt 2: Ended early')).toBeTruthy();
    // The legend lists only what happened today.
    expect(screen.queryByText('Reached with the glove')).toBeNull();
    expect(document.querySelectorAll('.mx-dot--partial')).toHaveLength(2);
  });
  it('split bars draw no orange and no glove legend when the glove added nothing', () => {
    const { container } = render(
      <SplitBars rows={[{ finger: 'index', own: 0.42, help: 0 }]} />,
    );
    expect(container.querySelector('.mx-fill--help')).toBeNull();
    expect(screen.queryByText('Glove added')).toBeNull();
    expect(screen.getByText('Still to open')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Index: 42% on your own' }),
    ).toBeVisible();
  });
  it('attempt feedback reads a resistance stop calmly', () => {
    render(<AttemptFeedbackCard result={resisted} />);
    // The live toast names the stopped finger (AttemptFeedbackCard); the recap
    // sentence keeps "The glove felt resistance and eased off."
    expect(
      screen.getByText('Good effort. We stopped to keep your index safe.'),
    ).toBeVisible();
    expect(screen.queryByText(/helped with the rest/)).toBeNull();
  });
});
