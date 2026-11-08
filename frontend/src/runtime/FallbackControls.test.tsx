import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RuntimeFallbackControls } from './FallbackControls';
const { subscribe } = vi.hoisted(() => ({
  subscribe: vi.fn((...args: unknown[]) => {
    void args;
    return () => {};
  }),
}));
vi.mock('./RuntimeProvider', () => ({
  useRuntime: () => ({ exercise: { onEvent: subscribe } }),
}));
vi.mock('../glove', () => ({ useGlove: () => ({ client: { kind: 'sim' } }) }));
vi.mock('../vision', () => ({
  useVision: () => ({ source: { kind: 'sim' } }),
}));
vi.mock('../voice', () => ({
  useVoice: () => ({ mode: 'simple', setMode: vi.fn() }),
}));
vi.mock('./SimulatorControls', () => ({
  RuntimeSimulatorControls: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
it('requires the demo or sim flag even when a simulated source is selected', () => {
  vi.stubEnv('VITE_DEMO', '0');
  vi.stubEnv('VITE_SIM', '0');
  render(<RuntimeFallbackControls />);
  expect(screen.queryByText('Demo tools')).toBeNull();
});
it('keeps demo tools in the setup shell and hides them throughout a live run', () => {
  vi.stubEnv('VITE_SIM', '1');
  const view = render(<RuntimeFallbackControls />);
  expect(screen.getByText('Demo tools')).toBeVisible();
  fireEvent.click(screen.getByText('Demo tools'));
  view.rerender(<RuntimeFallbackControls live />);
  expect(screen.getByText('Demo tools')).not.toBeVisible();
  view.rerender(<RuntimeFallbackControls />);
  expect(screen.getByText('Demo tools')).toBeVisible();
});
it('still closes an open popover on a safety event', () => {
  vi.stubEnv('VITE_SIM', '1');
  render(<RuntimeFallbackControls />);
  const menu = screen.getByText('Demo tools').closest('details')!;
  menu.open = true;
  const callback = subscribe.mock.calls.at(-1)![0] as unknown as (event: {
    kind: string;
  }) => void;
  callback({ kind: 'safety' });
  expect(menu.open).toBe(false);
});
