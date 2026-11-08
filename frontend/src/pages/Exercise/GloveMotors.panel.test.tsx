import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { closureFromPull } from '../../contracts/glove';
import { GloveMotors } from './GloveMotors';

vi.mock('../../glove', () => ({
  useGlove: () => ({ client: { kind: 'sim' } }),
  useGloveTelemetry: (select: (tel: unknown) => unknown) =>
    select({
      a: [0.8, 0.4, 0, 0.2, 1],
      tg: [0.95, 0.4, 0, 0.1, 1],
      st: 'run',
      md: 'target',
    }),
}));
afterEach(cleanup);
it('labels tendon pull as opening help without inverting it into camera closure', () => {
  render(<GloveMotors />);
  expect(
    screen.getByRole('region', { name: 'Glove opening help' }),
  ).toBeVisible();
  const thumb = screen.getByRole('meter', { name: 'Thumb opening help' });
  expect(thumb).toHaveAttribute('aria-valuenow', '80');
  expect(thumb).toHaveAttribute('aria-valuetext', '80% opening help, Helping');
  expect(closureFromPull(0.8)).toBeCloseTo(0.2);
  expect(
    screen.getByRole('meter', { name: 'Middle opening help' }),
  ).toHaveAttribute('aria-valuenow', '0');
  expect(
    screen.getByRole('meter', { name: 'Pinky opening help' }),
  ).toHaveAttribute('aria-valuenow', '100');
});
