import { describe, expect, it } from 'vitest';
import type { Quint } from '../contracts/glove';
import { OFFER_VOICE_MAX_S, PRESENT_VOICE_MAX_S } from './exercise';
import { Run } from './test/exerciseRun';

/**
 * The session waits for the live voice (docs: voice timing fix). Session 43 on the bench:
 * the pose invitation was heard 6 s into its attempt, and a "help" spoken 1 s after the
 * offer window (counted from the offer event, not from hearing it) moved help to the next
 * attempt. The voice now reports when it is busy; the engine waits, with caps.
 */
const CLOSED: Quint = [0.9, 0.9, 0.9, 0.9, 0.9];
const onRequest = { help_on_request: true, help_offer_s: 2 } as const;

function stepFor(run: Run, ms: number) {
  for (let t = 0; t < ms; t += 50) run.step();
}
function phase(run: Run) {
  return run.engine.state().phase;
}
function offerUp(run: Run) {
  for (let i = 0; i < 2000 && !run.engine.helpOffered(); i++) run.step();
  expect(run.engine.helpOffered()).toBe(true);
}

describe('PRESENT waits for the coach to finish the invitation', () => {
  it('without a live voice, the attempt starts on time as before', () => {
    const run = new Run('open', { present_s: 1 });
    stepFor(run, 1600);
    expect(phase(run)).toBe('ATTEMPT');
  });

  it('holds PRESENT while the coach is still speaking, then starts once it is done', () => {
    const run = new Run('open', { present_s: 1 });
    run.engine.setVoiceBusy(run.world.now, true);
    stepFor(run, 4000);
    expect(phase(run)).toBe('PRESENT');
    run.engine.setVoiceBusy(run.world.now, false);
    run.step();
    expect(phase(run)).toBe('ATTEMPT');
  });

  it('waiting for the coach with the hand in view never re-prompts the pose', () => {
    // Live run: an 8 s wait re-sent PRESENT, and the coach asked to raise a visible hand.
    const run = new Run('open', { present_s: 5 });
    run.engine.setVoiceBusy(run.world.now, true);
    stepFor(run, 10_500);
    const presents = run.events.filter(
      (e) => e.kind === 'phase' && e.phase === 'PRESENT',
    );
    expect(presents).toHaveLength(1);
  });

  it('never waits more than PRESENT_VOICE_MAX_S for a voice that stays busy', () => {
    const run = new Run('open', { present_s: 1 });
    run.engine.setVoiceBusy(run.world.now, true);
    stepFor(run, (1 + PRESENT_VOICE_MAX_S) * 1000 - 300);
    expect(phase(run)).toBe('PRESENT');
    stepFor(run, 600);
    expect(phase(run)).toBe('ATTEMPT');
  });
});

describe('the help offer counts from when it is heard', () => {
  it('a request after the coach finished asking still helps in the same attempt', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    offerUp(run);
    const index = run.engine.state().index;
    // The coach takes 5 s to ask (queued behind another sentence, then speaking):
    // with a 2 s offer, the old window would already be closed.
    run.engine.setVoiceBusy(run.world.now, true);
    stepFor(run, 5000);
    expect(run.engine.helpOffered()).toBe(true);
    run.engine.setVoiceBusy(run.world.now, false);
    stepFor(run, 1500);
    expect(run.engine.helpOffered()).toBe(true);
    run.accept(run.engine.requestHelp(run.world.now));
    expect(phase(run)).toBe('ASSIST');
    expect(run.engine.state().index).toBe(index);
  });

  it('the patient speaking pauses the countdown too', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    offerUp(run);
    stepFor(run, 1500); // 1.5 of 2 quiet seconds used
    run.engine.setVoiceBusy(run.world.now, true); // the patient starts answering
    stepFor(run, 3000);
    expect(run.engine.helpOffered()).toBe(true);
    run.engine.setVoiceBusy(run.world.now, false);
    stepFor(run, 300);
    expect(run.engine.helpOffered()).toBe(true);
  });

  it('ends after the quiet offer time once nobody is speaking', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    offerUp(run);
    stepFor(run, 2200);
    expect(run.engine.helpOffered()).toBe(false);
    expect(['RELEASE', 'REST', 'DONE']).toContain(phase(run));
    expect(run.events.some((e) => e.kind === 'phase' && e.phase === 'ASSIST')).toBe(false);
  });

  it('never waits more than OFFER_VOICE_MAX_S extra for a voice that stays busy', () => {
    const run = new Run('open', onRequest);
    run.world.hand = [...CLOSED] as Quint;
    offerUp(run);
    run.engine.setVoiceBusy(run.world.now, true);
    stepFor(run, (2 + OFFER_VOICE_MAX_S) * 1000 - 300);
    expect(run.engine.helpOffered()).toBe(true);
    stepFor(run, 600);
    expect(run.engine.helpOffered()).toBe(false);
    expect(run.events.some((e) => e.kind === 'phase' && e.phase === 'ASSIST')).toBe(false);
  });
});
