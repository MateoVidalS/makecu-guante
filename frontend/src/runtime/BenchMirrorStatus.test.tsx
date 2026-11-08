import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { benchMirror, type BenchMirrorState } from '../glove/benchMirror';

let kind: 'sim' | 'serial' = 'sim';
vi.mock('../glove', () => ({ useGlove: () => ({ client: { kind } }) }));
const { BenchMirrorStatus } = await import('./BenchMirrorStatus');
const setMirror = (patch: Partial<BenchMirrorState>) =>
  act(() =>
    (
      benchMirror as unknown as { update(p: Partial<BenchMirrorState>): void }
    ).update(patch),
  );
afterEach(() => {
  cleanup();
  setMirror({
    active: false,
    connection: 'disconnected',
    commands: 0,
    lastEvent: null,
  });
});

it('warns when the simulated session drives no real motors', () => {
  render(<BenchMirrorStatus />);
  expect(screen.getByTestId('bench-mirror-status').textContent).toMatch(
    /not connected/,
  );
});

it('shows commands and board events while mirroring, live', () => {
  render(<BenchMirrorStatus />);
  setMirror({
    active: true,
    connection: 'connected',
    commands: 12,
    lastEvent: { t: 1, e: 'overcurrent', ma: 720 },
  });
  expect(screen.getByTestId('bench-mirror-status').textContent).toBe(
    'Real motors: connected, 12 commands sent, last board event: overcurrent',
  );
});

it('is hidden with the real glove, which is the motors itself', () => {
  kind = 'serial';
  const { container } = render(<BenchMirrorStatus />);
  expect(container.textContent).toBe('');
});
