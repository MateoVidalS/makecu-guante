import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AttemptResult, SessionSummary } from '../contracts/engine';
import { GLOVE_FINGERS } from '../contracts/glove';
import { POSES } from '../contracts/poses';
import type { ExerciseView } from '../contracts/runtime';
import { attemptContext, movementContext, summaryContext } from './context';
import { eventCue } from './cues';

const view: ExerciseView = {
  phase: 'ATTEMPT',
  pose: POSES.hook,
  rep: 1,
  index: 0,
  total: 1,
  phaseElapsed: 0,
  phaseDuration: 6,
  activeMax: {},
  assisting: false,
  paused: false,
  sessionId: null,
  lastResult: null,
  summary: null,
};
const result: AttemptResult = {
  ...JSON.parse(
    readFileSync('../contracts/fixtures/session_detail.json', 'utf8'),
  ).attempts[0],
  pose: 'full_fist',
  active_ratio: 0.9,
  reached_final: true,
  assisted: true,
  interrupted: false,
  fingers: GLOVE_FINGERS.map((finger) => ({
    finger,
    scored: true,
    target: 0.9,
    active_max: finger === 'ring' ? 0.4 : finger === 'pinky' ? 0.5 : 0.9,
    assist_needed: finger === 'ring' ? 0.5 : finger === 'pinky' ? 0.4 : 0,
    final: 0.9,
  })),
};
const summary: SessionSummary = {
  attempts: 3,
  reached_active: 1,
  assisted: 2,
  interrupted: 0,
  active_ratio_mean: 0.8,
  per_pose: [],
  per_finger: result.fingers.map((f) => ({
    finger: f.finger,
    active_max_mean: f.active_max,
    assist_needed_mean: f.assist_needed,
  })),
  previous: {
    active_ratio_mean: 0.7,
    per_finger: GLOVE_FINGERS.map((finger) => ({
      finger,
      active_max_mean: 0.3,
    })),
  },
};

describe('compact five-finger context', () => {
  it('keeps only unmet targets and names ring and little finger', () => {
    expect(
      movementContext({
        ...view,
        activeMax: {
          thumb: 0.1,
          index: 0.6,
          middle: 0.7,
          ring: 0.4,
          pinky: 0.5,
        },
      }),
    ).toBe('ring 40%/60%; little finger 50%/60%');
    expect(movementContext(view)).toBe('no measured fingers short of target');
  });

  it.each(GLOVE_FINGERS)(
    'names %s in progress and assistance cues',
    (finger) => {
      const closing = { ...view, pose: POSES.full_fist };
      const progress = eventCue(
        { kind: 'progress', finger, active_max: 0.4 },
        closing,
      );
      const name = finger === 'pinky' ? 'little finger' : finger;
      expect(progress?.text).toContain(`${name} now at 40%`);
      const cue = eventCue(
        {
          kind: 'assist_started',
          fingers: [finger],
          from: [0.4, 0.4, 0.4, 0.4, 0.4],
          to: [0.7, 0.9, 0.9, 0.9, 0.9],
        },
        closing,
      );
      expect(cue?.text).toBe(
        `[session] Not reached alone (${name} 40%/${finger === 'thumb' ? '70' : '90'}%). The glove is helping now.`,
      );
    },
  );

  it('omits free and reached fingers from progress and reconnect context', () => {
    const pinch = {
      ...view,
      pose: POSES.pinch,
      activeMax: { thumb: 0.5, index: 0.6, ring: 0.2, pinky: 0.3 },
    };
    expect(movementContext(pinch)).toBe('no measured fingers short of target');
    expect(
      eventCue({ kind: 'progress', finger: 'pinky', active_max: 0.3 }, pinch),
    ).toBeNull();
    expect(
      eventCue({ kind: 'progress', finger: 'index', active_max: 0.6 }, pinch),
    ).toBeNull();
  });

  it('uses event arrays for just the fingers receiving assistance', () => {
    expect(
      eventCue(
        {
          kind: 'assist_started',
          fingers: ['pinky', 'ring'],
          from: [0, 0, 0, 0.4, 0.5],
          to: [0, 0, 0, 0.6, 0.6],
        },
        view,
      )?.text,
    ).toBe(
      '[session] Not reached alone (ring 40%/60%; little finger 50%/60%). The glove is helping now.',
    );
  });

  it('summarizes only unmet or helped fingers with matching previous measurements', () => {
    expect(attemptContext(result, result)).toBe(
      'active effort 90%; reached yes; glove assisted yes; interrupted no. Fingers below target or needing help: ring active 40%/90%, help needed 50% (previous 40%); little finger active 50%/90%, help needed 40% (previous 50%). Previous rep: included where comparable.',
    );
    expect(attemptContext(result, { ...result, pose: 'hook' })).not.toContain(
      '(previous',
    );
    expect(
      attemptContext(result, {
        ...result,
        fingers: result.fingers.map((f) => ({ ...f, target: 0.6 })),
      }),
    ).not.toContain('(previous');
  });

  it('keeps helped fingers even if the active measurement is now at target', () => {
    const helped = {
      ...result,
      fingers: [{ ...result.fingers[4], active_max: 0.9 }],
    };
    expect(attemptContext(helped)).toContain(
      'little finger active 90%/90%, help needed 40%',
    );
  });

  it('does not claim help was delivered when it was only needed', () => {
    const text = attemptContext({ ...result, assisted: false });
    expect(text).toContain('glove assisted no');
    expect(text).toContain('help needed 50%');
    expect(text).not.toContain('glove helped');
  });

  it('handles opening targets without treating lower closure as a shortfall', () => {
    expect(
      movementContext({
        ...view,
        pose: POSES.open,
        activeMax: { ring: 0.2, pinky: 0 },
      }),
    ).toBe('ring 20%/0%');
    expect(
      attemptContext({
        ...result,
        pose: 'open',
        fingers: [
          {
            ...result.fingers[3],
            target: 0,
            active_max: 0.2,
            assist_needed: 0.2,
          },
          { ...result.fingers[4], target: 0, active_max: 0, assist_needed: 0 },
        ],
      }),
    ).toContain('ring active 20%/0%, help needed 20%');
  });

  it('does not invent missing measurements or successful fingers', () => {
    const missing = {
      ...result,
      fingers: [
        { ...result.fingers[4], active_max: null, assist_needed: null },
      ],
    };
    expect(attemptContext(missing)).toContain('none measured');
    expect(attemptContext(missing)).not.toContain('little finger');
    const reached = {
      ...result,
      fingers: [{ ...result.fingers[4], active_max: 0.9, assist_needed: 0 }],
    };
    expect(attemptContext(reached)).not.toContain('little finger');
    expect(
      attemptContext({
        ...result,
        fingers: result.fingers.map((f) => ({ ...f, scored: false })),
      }),
    ).toContain('none measured');
  });

  it('recaps assistance and matching prior values without dumping all metrics', () => {
    const text = summaryContext(summary);
    expect(text).toBe(
      '3 attempts, 1 reached alone, 2 assisted, 0 interrupted; active effort 80%. Fingers needing help: ring active 40%, mean help needed 50% (previous active 30%); little finger active 50%, mean help needed 40% (previous active 30%). Previous active effort: 70%.',
    );
    expect(text.length).toBeLessThan(JSON.stringify(summary).length);
    expect(eventCue({ kind: 'session_done', summary }, view)?.text).toContain(
      text,
    );
  });

  it('handles empty summaries and older sessions without ring or little measurements', () => {
    expect(summaryContext(null)).toBe('unavailable');
    const old = {
      ...summary,
      per_finger: summary.per_finger.slice(0, 3),
      previous: null,
    };
    expect(summaryContext(old)).toContain('none measured');
    expect(summaryContext(old)).not.toContain('little finger');
    expect(
      summaryContext({ ...summary, previous: old.previous }),
    ).not.toContain('(previous active');
  });
});
