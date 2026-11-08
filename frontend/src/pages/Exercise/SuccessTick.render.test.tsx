import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AttemptResult, ExercisePhase } from '../../contracts/engine';
import { SuccessTick } from './SuccessTick';

afterEach(() => vi.useRealTimers());

it('"Perfect!" appears when the hold ends and leaves the screen, across fast phase changes', () => {
  vi.useFakeTimers();
  const result = {
    index: 0,
    interrupted: false,
    reached_active: true,
    reached_final: true,
    assisted: false,
  } as AttemptResult;
  const view = (phase: ExercisePhase, r: AttemptResult | null = null) => (
    <SuccessTick phase={phase} index={0} result={r} duration={1600} />
  );
  const { rerender } = render(view('HOLD'));
  expect(screen.queryByText('Perfect!')).toBeNull();
  rerender(view('RELEASE'));
  expect(screen.getByText('Perfect!')).toBeTruthy();
  // RELEASE lasts 0.5 s, then REST arrives with the result.
  act(() => vi.advanceTimersByTime(500));
  rerender(view('REST', result));
  expect(screen.getByText('Perfect!')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1200));
  expect(screen.queryByText('Perfect!')).toBeNull();
  // Shown once per attempt: staying in REST does not bring it back.
  rerender(view('REST', { ...result }));
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText('Perfect!')).toBeNull();
});
