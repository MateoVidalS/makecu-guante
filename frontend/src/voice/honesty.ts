/**
 * The coach must never tell the patient the glove is helping when it is not.
 *
 * A Live model speaks and calls tools separately, so it can say "the glove is now
 * assisting your index" without ever calling assist_finger_now. This detects such a
 * claim in a finished coach line; VoiceController then checks it against what the
 * runtime actually did and corrects the coach when nothing was applied.
 */
const HELP = /\b(?:help(?:s|ing)?|assist(?:s|ing)?)\b/;
const ACTOR =
  /\b(?:glove|i(?:'m| am| will|'ll)?|let me|we(?:'ll| will| are|'re)?|now|already)\b/;
// A claim is about help happening now, or about a specific finger. "The glove will help
// you open" only describes the device (true while assistance is on) and is not a claim.
const NOW_OR_FINGER =
  /\b(?:helping|assisting|thumb|index|middle|ring|little|pinky|fingers?)\b/;
const OFFER =
  /\b(?:would you like|do you want|shall i|should i|can i|if you (?:want|like)|ask me)\b/;

/** True when a sentence states (not offers) that the glove helps or will help. */
export function claimsGloveHelp(text: string): boolean {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/(?<=[.!?])\s+/)
    .some(
      (sentence) =>
        !sentence.trim().endsWith('?') &&
        !OFFER.test(sentence) &&
        !/\b(?:no|not|can't|cannot|couldn't|won't)\b/.test(sentence) &&
        HELP.test(sentence) &&
        ACTOR.test(sentence) &&
        NOW_OR_FINGER.test(sentence),
    );
}

export const HONESTY_CORRECTION =
  '[correction] You just told the patient the glove is helping, but no help was applied: ' +
  'no assist_finger_now call succeeded and the glove is not helping any finger. Say so ' +
  'plainly in one short sentence. If the patient asked for help, call assist_finger_now ' +
  'for each finger they named (between attempts it is set for the next opening attempt) ' +
  'and only describe it after the tool returns ok.';
