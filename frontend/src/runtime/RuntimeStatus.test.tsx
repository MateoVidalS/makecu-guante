import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createStore } from 'zustand/vanilla';
import { RuntimeStatus } from './RuntimeStatus';
import { RehabRuntime } from './runtime';

const runtime = Object.assign(Object.create(RehabRuntime.prototype), {
  persistence: {
    store: createStore(() => ({ status: 'Saved', pending: 0, durable: true })),
  },
});
vi.mock('./RuntimeProvider', () => ({ useRuntime: () => runtime }));
vi.mock('../glove', () => ({ useGlove: () => ({ events: [] }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps healthy persistence quiet in focus, shows slow saving and Offline immediately', () => {
  vi.useFakeTimers();
  render(<RuntimeStatus focus />);
  expect(screen.queryByLabelText('Session saving status')).toBeNull();
  act(() =>
    runtime.persistence.store.setState({ status: 'Saving…', pending: 1 }),
  );
  act(() => vi.advanceTimersByTime(1999));
  expect(screen.queryByLabelText('Session saving status')).toBeNull();
  act(() => vi.advanceTimersByTime(2));
  expect(screen.getByLabelText('Session saving status')).toHaveTextContent(
    'Saving…',
  );
  act(() =>
    runtime.persistence.store.setState({ status: 'Saved', pending: 0 }),
  );
  expect(screen.queryByLabelText('Session saving status')).toBeNull();
  act(() =>
    runtime.persistence.store.setState({ status: 'Offline', pending: 1 }),
  );
  expect(screen.getByLabelText('Session saving status')).toHaveTextContent(
    'Offline',
  );
});
it('retains Saved in the setup shell', () => {
  runtime.persistence.store.setState({ status: 'Saved', pending: 0 });
  render(<RuntimeStatus />);
  expect(screen.getByLabelText('Session saving status')).toHaveTextContent(
    'Saved',
  );
});
