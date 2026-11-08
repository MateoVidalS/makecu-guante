import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useHighlightedFinger } from './useHighlightedFinger';
import { FakeTherapy } from './testing/FakeTherapy';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('responds to coach focus and observes expiry without another decision', () => {
  vi.useFakeTimers();
  const therapy = new FakeTherapy();
  const { result, unmount } = renderHook(() => useHighlightedFinger(therapy));
  expect(result.current).toBeNull();
  act(() => {
    therapy.emit('highlight_finger', { finger: 'index' });
  });
  expect(result.current).toBe('index');
  act(() => {
    therapy.live!.highlighted_finger = null;
    vi.advanceTimersByTime(250);
  });
  expect(result.current).toBeNull();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
