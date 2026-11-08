import { expect, it } from 'vitest';
import { claimsGloveHelp } from './honesty';

it.each([
  'The glove is now assisting your index finger to open.',
  'The glove is already assisting you with your index finger opening.',
  "I'll help your index open.",
  'Good effort. I will help you open.',
  'Let me help your middle finger.',
  'Okay. Now helping your ring finger.',
])('flags a help claim: %s', (line) =>
  expect(claimsGloveHelp(line)).toBe(true),
);

it.each([
  'Would you like me to help your index finger?',
  'Do you want the glove to assist your thumb next time?',
  'Can I help you open a bit more?',
  'The glove is not helping right now.',
  'You opened your hand fully without any help. Great job.',
  'Make a full fist.',
  'How does your hand feel, from zero to ten?',
])('ignores offers, questions and negatives: %s', (line) =>
  expect(claimsGloveHelp(line)).toBe(false),
);
