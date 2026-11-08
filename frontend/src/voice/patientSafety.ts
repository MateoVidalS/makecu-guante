/** Deterministic transcription rules. Run on interim text, before any model tools. */
export function normalizePatientText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}
const ratings: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  cero: 0,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};
const rating =
  '(10|[0-9](?:\\.[0-9]+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';

export function reportedPain(
  text: string,
  awaitingPain = false,
): number | null {
  const normalized = normalizePatientText(text);
  const match =
    normalized.match(
      new RegExp(
        `\\b(?:pain|dolor)\\b(?: (?:is|at|level|of|es|de|un|una|a|an|about|around|nivel)){0,4} ${rating}\\b`,
      ),
    ) ??
    normalized.match(
      new RegExp(
        `\\b${rating} (?:out of (?:10|ten)|de (?:10|diez)) (?:pain|dolor)\\b`,
      ),
    ) ??
    (awaitingPain
      ? normalized.match(
          new RegExp(`^${rating}(?: (?:out of|de) (?:10|ten|diez))?\\s*$`),
        )
      : null);
  if (!match) return null;
  return ratings[match[1]] ?? Number(match[1]);
}

export function patientBrakeReason(
  text: string,
  awaitingPain = false,
): string | null {
  const normalized = normalizePatientText(text);
  // Conservative on negation: a recognized stop word always wins.
  if (/\b(stop|enough|para|basta|detente|alto)\b/.test(normalized))
    return 'Patient asked to stop.';
  if (
    /\b(it hurts|that hurts|this hurts|hurts|painful|me duele|duele|doloroso)\b/.test(
      normalized,
    )
  )
    return 'Patient reported pain.';
  const pain = reportedPain(text, awaitingPain);
  return pain !== null && pain >= 4
    ? `Patient reported pain ${pain}/10.`
    : null;
}

const FINGER_WORDS: [
  RegExp,
  'thumb' | 'index' | 'middle' | 'ring' | 'pinky',
][] = [
  [/\b(thumb|pulgar)\b/, 'thumb'],
  [/\b(index|pointer|indice)\b/, 'index'],
  [/\b(middle|medio|mayor|corazon)\b/, 'middle'],
  [/\b(ring|anular)\b/, 'ring'],
  [/\b(little|pinky|pinkie|small|menique|chiquito)\b/, 'pinky'],
];

/**
 * Fingers a patient names in a help request ("help my index and middle", "ayudame con
 * el pulgar"). Empty when none are named or the whole hand is meant, which asks for
 * every finger that needs opening.
 */
export function namedFingers(
  text: string,
): ('thumb' | 'index' | 'middle' | 'ring' | 'pinky')[] {
  const said = normalizePatientText(text);
  if (
    /\b(all|every|whole|todos|todas|toda la mano|la mano entera)\b/.test(said)
  )
    return [];
  return FINGER_WORDS.filter(([word]) => word.test(said)).map(([, f]) => f);
}

/** The patient's own words ask for the glove's help, or say yes to an offer. */
export function asksForHelp(text: string): boolean {
  const said = normalizePatientText(text);
  if (/\b(no|not|dont|stop|para|basta|no quiero)\b/.test(said)) return false;
  return (
    /\b(help|ayuda|ayudame|ayudar|ayudes|assist)\b/.test(said) ||
    /^(yes|yeah|yep|sure|please|si|dale|bueno|ok|okay|por favor)\b/.test(said)
  );
}
