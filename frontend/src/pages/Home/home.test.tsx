import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Home from './index';
import {
  helperRuntime,
  mountHelper,
  resetHelperStorage,
} from '../../components/calibration/testSupport';
vi.mock('../../api/client', async (original) => ({
  ...(await original<typeof import('../../api/client')>()),
  useProfile: () => ({ data: null }),
  useSessions: () => ({ data: [] }),
}));
beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  resetHelperStorage();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
it('shows invalid calibration honestly and sends Start and Fix to its camera repair', () => {
  const runtime = helperRuntime();
  runtime.calibration.current!.camera.closed_flex.index = 200;
  const start = vi.spyOn(runtime.exercise, 'start');
  mountHelper(<Home />, runtime);
  const checklist = screen.getByRole('list', { name: 'Readiness checklist' });
  expect(within(checklist).getByText('Needs a quick redo')).toBeVisible();
  expect(
    within(screen.getByText('Needs a quick redo').closest('li')!).getByRole(
      'link',
      { name: 'Fix' },
    ),
  ).toHaveAttribute('href', '/calibrate?step=camera&finger=index');
  expect(
    screen.getByRole('link', { name: 'Redo camera range' }),
  ).toHaveAttribute('href', '/calibrate?step=camera&finger=index');
  fireEvent.click(
    screen.getByRole('button', { name: "Start today's practice" }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/calibrate?step=camera&finger=index',
  );
  expect(start).not.toHaveBeenCalled();
});
it('routes a missing calibration to the wizard with an explanation', () => {
  const runtime = helperRuntime();
  runtime.calibration.current = null;
  mountHelper(<Home />, runtime);
  expect(screen.getByText(/Calibration needed/)).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: "Start today's practice" }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/calibrate',
  );
});
