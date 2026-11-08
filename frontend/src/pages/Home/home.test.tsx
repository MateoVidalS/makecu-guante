import { CURRENT_FLEX_MODEL } from '../../contracts/calibration';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Home from './index';
import { useGlove } from '../../glove';
import { CURRENT_SENSOR_MISSING_MESSAGE } from '../Setup/CurrentSensorNotice';
import {
  helperRuntime as legacyHelperRuntime,
  mountHelper,
  resetHelperStorage,
} from '../../components/calibration/testSupport';
function helperRuntime() {
  const runtime = legacyHelperRuntime();
  runtime.calibration.current!.camera.camera_view = 'front_upright';
  runtime.calibration.current!.camera.flex_model = CURRENT_FLEX_MODEL;
  return runtime;
}
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

it('routes old-view calibration to camera recapture before practice', () => {
  const runtime = legacyHelperRuntime();
  delete runtime.calibration.current!.camera.camera_view;
  const start = vi.spyOn(runtime.exercise, 'start');
  mountHelper(<Home />, runtime);
  expect(
    screen.getByRole('link', { name: 'Redo camera range' }),
  ).toHaveAttribute('href', '/calibrate?step=camera');
  expect(screen.getByText(/Support your elbow and relax/)).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: "Start today's practice" }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/calibrate?step=camera',
  );
  expect(start).not.toHaveBeenCalled();
});

it('shows calibration-only glove readiness and routes practice to Setup when INA219 is missing', async () => {
  function SensorEvent() {
    const { store } = useGlove();
    return (
      <button
        onClick={() => store.setState({ events: [{ t: 1, e: 'ina_missing' }] })}
      >
        Report missing sensor
      </button>
    );
  }
  const runtime = helperRuntime();
  const start = vi.spyOn(runtime.exercise, 'start');
  mountHelper(
    <>
      <Home />
      <SensorEvent />
    </>,
    runtime,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Report missing sensor' }),
  );
  expect(screen.getByText(CURRENT_SENSOR_MISSING_MESSAGE)).toBeVisible();
  await screen.findByText('Sees the hand', { exact: true });
  const checklist = screen.getByRole('list', { name: 'Readiness checklist' });
  expect(within(checklist).getByText('Calibration only')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: "Start today's practice" }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/setup');
  expect(start).not.toHaveBeenCalled();
});
