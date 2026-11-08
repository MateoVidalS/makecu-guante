import { expect, it } from 'vitest';
import { asksForHelp, namedFingers } from './patientSafety';

it.each([
  ['Help my index', ['index']],
  ['Can you help my index and middle fingers?', ['index', 'middle']],
  [
    'Please help my thumb, my ring finger and my little finger.',
    ['thumb', 'ring', 'pinky'],
  ],
  ['Ayúdame con el pulgar y el meñique', ['thumb', 'pinky']],
  ['ayuda con el índice', ['index']],
  ['Help', []],
  ['Help all my fingers', []],
  ['Ayudame con toda la mano', []],
])('%s → %j', (text, fingers) => expect(namedFingers(text)).toEqual(fingers));

it.each([
  ['I need help moving the index.', true],
  ['ayúdame por favor', true],
  ['Yes, please', true],
  ['sí, dale', true],
  ['My hand feels fine.', false],
  ['No, not now.', false],
  ["Don't help me", false],
])('asksForHelp(%s) → %s', (text, yes) => expect(asksForHelp(text)).toBe(yes));
