import { describe, expect, it } from 'vitest';
import { pullFromClosure, type Quint } from '../contracts/glove';
import { Run } from './test/exerciseRun';

/** Production behaviour: the glove moves only when the patient asks. */
const onRequest = { help_on_request: true, help_offer_s: 2 } as const;
const CLOSED: Quint = [0.9, 0.9, 0.9, 0.9, 0.9];

/** Highest pull ever commanded for any finger, minus what plain following allows. */
function pulledBeyondFollow(run: Run): boolean {
  return run.outputs.some((o) =>
    o.commands.some(
      (c) =>
        c.t === 'target' &&
        c.f.some((p, i) => p > pullFromClosure(CLOSED[i]) + 1e-6),
    ),
  );
}

describe('the glove helps only when the patient asks', () => {
  it('not reached: help is offered, nothing moves, and the attempt ends after the offer', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    run.until('DONE', 20000);
    expect(run.events.some((e) => e.kind === 'help_offered')).toBe(true);
    expect(
      run.events.some((e) => e.kind === 'phase' && e.phase === 'ASSIST'),
    ).toBe(false);
    expect(pulledBeyondFollow(run)).toBe(false);
    const [result] = run.results();
    expect(result.assisted).toBe(false);
    expect(result.reached_final).toBe(false);
  });

  it('asking during the offer starts help', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    for (let i = 0; i < 2000 && !run.engine.helpOffered(); i++) run.step();
    expect(run.engine.helpOffered()).toBe(true);
    run.accept(run.engine.requestHelp(run.world.now));
    expect(run.engine.state().phase).toBe('ASSIST');
    run.until('REST', 4000);
    expect(pulledBeyondFollow(run)).toBe(true);
    expect(run.results()[0].assisted).toBe(true);
  });

  it('asking before time runs out starts help right away for every finger that needs it', () => {
    const run = new Run('open', { ...onRequest, attempt_s: 6 });
    run.world.hand = [...CLOSED] as Quint;
    run.until('ATTEMPT');
    run.step();
    run.accept(run.engine.requestHelp(run.world.now));
    expect(run.engine.state().phase).toBe('ASSIST');
    for (let i = 0; i < 40; i++) run.step();
    // Staggered starts, but without waiting out the attempt time.
    const started = new Set(
      run.outputs.flatMap((o) =>
        o.commands.flatMap((c) =>
          c.t === 'target'
            ? c.f.flatMap((p, i) =>
                p > pullFromClosure(CLOSED[i]) + 1e-6 ? [i] : [],
              )
            : [],
        ),
      ),
    );
    expect(started.size).toBeGreaterThanOrEqual(3);
  });

  it('reaching during the offer counts as done on your own, with no help', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    for (let i = 0; i < 2000 && !run.engine.helpOffered(); i++) run.step();
    run.world.hand = [0.05, 0.05, 0.05, 0.05, 0.05];
    run.until('HOLD', 2000);
    run.until('REST', 2000);
    const [result] = run.results();
    expect(result.reached_active).toBe(true);
    expect(result.assisted).toBe(false);
  });

  it('closing poses never offer help (the glove cannot close)', () => {
    const run = new Run('full_fist', onRequest);
    run.world.hand = [0.2, 0.2, 0.2, 0.2, 0.2];
    run.until('DONE', 20000);
    expect(run.events.some((e) => e.kind === 'help_offered')).toBe(false);
    run.accept(run.engine.requestHelp(run.world.now));
    expect(run.engine.state().phase).toBe('DONE');
  });

  it('the coach cannot start help on its own before the patient asks', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    run.until('ATTEMPT');
    run.step();
    const decision = run.engine.therapy.adjust(
      'assist_finger_now',
      { finger: 'index', reason: 'Start index help.' },
      'coach',
    );
    expect(decision.result).not.toBe('applied');
    expect(run.engine.state().phase).toBe('ATTEMPT');
  });

  it('help asked between attempts starts in the next opening attempt, on that finger only', () => {
    const run = new Run('open', { ...onRequest, attempt_s: 9 });
    run.world.hand = [...CLOSED] as Quint;
    // Asked before the attempt (e.g. during a check-in): the coach queues it.
    const queued = run.engine.therapy.adjust(
      'assist_finger_now',
      { finger: 'index', reason: 'The patient asked for index help.' },
      'coach',
    );
    expect(queued.result).toBe('applied');
    run.until('ASSIST', 4000);
    for (let i = 0; i < 40; i++) run.step();
    const pulled = new Set(
      run
        .targets()
        .flatMap((t) =>
          t.f.flatMap((p, i) =>
            p > pullFromClosure(CLOSED[i]) + 1e-6 ? [i] : [],
          ),
        ),
    );
    expect([...pulled]).toEqual([1]);
  });

  it('once the patient asked, the coach can add a finger, and nothing is queued for later', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    run.until('ATTEMPT');
    run.step();
    run.accept(run.engine.requestHelp(run.world.now));
    expect(run.engine.state().phase).toBe('ASSIST');
    run.engine.therapy.adjust(
      'assist_finger_now',
      { finger: 'ring', reason: 'The patient named the ring finger.' },
      'coach',
    );
    expect(run.engine.therapy.queuedHelp()).toEqual([]);
  });
});
