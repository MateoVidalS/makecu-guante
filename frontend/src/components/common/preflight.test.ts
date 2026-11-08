import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  gloveRecalibrationPending,
  guidesReattached,
  readPracticePreflight,
  updatePracticePreflight,
} from './preflight';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('starts unconfirmed and stores both confirmations for this tab', () => {
  expect(readPracticePreflight()).toEqual({
    guidesNotReattached: false,
    skinNormal: false,
  });
  updatePracticePreflight({ guidesNotReattached: true });
  expect(readPracticePreflight()).toEqual({
    guidesNotReattached: true,
    skinNormal: false,
  });
  updatePracticePreflight({ skinNormal: true });
  expect(
    JSON.parse(sessionStorage.getItem('rehab-hub.practice.preflight')!),
  ).toEqual({
    guidesNotReattached: true,
    skinNormal: true,
  });
  sessionStorage.clear();
  expect(readPracticePreflight()).toEqual({
    guidesNotReattached: false,
    skinNormal: false,
  });
});

it('clears both confirmations on re-attachment and awaits a new calibration', () => {
  updatePracticePreflight({ guidesNotReattached: true, skinNormal: true });
  guidesReattached(42);
  const state = readPracticePreflight();
  expect(state).toEqual({
    guidesNotReattached: false,
    skinNormal: false,
    recalibrateFrom: 42,
  });
  expect(gloveRecalibrationPending(state, 42)).toBe(true);
  expect(gloveRecalibrationPending(state, null)).toBe(true);
  expect(gloveRecalibrationPending(state, 43)).toBe(false);
  expect(readPracticePreflight().guidesNotReattached).toBe(false);
  expect(readPracticePreflight().skinNormal).toBe(false);
});

it.each([
  'broken json',
  'null',
  '{"guidesNotReattached":"true","skinNormal":1}',
])('requires confirmation when stored data is invalid: %s', (raw) => {
  updatePracticePreflight({ guidesNotReattached: true, skinNormal: true });
  sessionStorage.setItem('rehab-hub.practice.preflight', raw);
  expect(readPracticePreflight()).toEqual({
    guidesNotReattached: false,
    skinNormal: false,
  });
});

it('keeps confirmations in memory when session storage cannot be written', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  updatePracticePreflight({ guidesNotReattached: true });
  updatePracticePreflight({ skinNormal: true });
  expect(readPracticePreflight()).toEqual({
    guidesNotReattached: true,
    skinNormal: true,
  });
  vi.restoreAllMocks();
  updatePracticePreflight({ guidesNotReattached: false, skinNormal: false });
});
