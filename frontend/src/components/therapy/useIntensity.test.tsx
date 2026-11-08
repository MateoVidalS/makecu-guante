import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { FakeTherapy } from './testing/FakeTherapy';
import { useIntensity } from './useIntensity';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('shows accepted intensity and automatic restoration without fabricating patient speech', () => {
  vi.useFakeTimers();
  const therapy = new FakeTherapy();
  const { result, unmount } = renderHook(() => useIntensity(therapy, 1));
  act(() => {
    therapy.live!.adjustments.intensified = ['index', 'middle'];
    therapy.emit('intensify', {
      finger: 'index',
      kind: 'further',
      consent: 'patient_asked',
      patient_quote: 'A little further, please.',
    });
  });
  expect(result.current.active).toEqual(['index', 'middle']);
  act(() => {
    therapy.live!.adjustments.intensified = ['middle'];
    therapy.emit(
      'intensify',
      { finger: 'index', reason: 'Resistance. Returning to gentle help.' },
      'undone',
      'local_rule',
    );
  });
  expect(result.current).toEqual({
    active: ['middle'],
    restored: ['index'],
    automatic: true,
  });
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(result.current.automatic).toBe(true);
  expect(therapy.patientSpeech).toEqual([]);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('observes restoration without an event and resets the notice for a new session', () => {
  vi.useFakeTimers();
  const therapy = new FakeTherapy();
  therapy.live!.adjustments.intensified = ['ring'];
  const { result, rerender } = renderHook(
    ({ sessionId }) => useIntensity(therapy, sessionId),
    { initialProps: { sessionId: 1 } },
  );
  act(() => {
    therapy.live!.adjustments.intensified = [];
    vi.advanceTimersByTime(250);
  });
  expect(result.current.restored).toEqual(['ring']);
  rerender({ sessionId: 2 });
  expect(result.current).toEqual({
    active: [],
    restored: [],
    automatic: false,
  });
});
