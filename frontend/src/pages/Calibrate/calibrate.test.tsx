import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Calibrate from './index';
import {
  helperRuntime as legacyHelperRuntime,
  mountHelper,
  resetHelperStorage,
} from '../../components/calibration/testSupport';
function helperRuntime() {
  const runtime = legacyHelperRuntime();
  runtime.calibration.current!.camera.camera_view = 'front_upright';
  return runtime;
}
vi.mock('../../vision/CameraOverlay', () => ({
  CameraOverlay: () => <div>Hand camera preview</div>,
}));
beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  resetHelperStorage();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it('opens a valid saved range on Review without unset fingers', () => {
  mountHelper(<Calibrate />, helperRuntime());
  expect(
    screen.getByRole('heading', { name: 'Review your range' }),
  ).toBeVisible();
  expect(screen.queryByText(/Not set/i)).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Save calibration' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Redo glove ranges' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Use simulated glove ranges' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: /^Calibrate simulator$/ }),
  ).toHaveLength(1);
});
it('flags an invalid saved value on Review and honors its repair deep link', () => {
  const runtime = helperRuntime();
  runtime.calibration.current!.camera.closed_flex.index = 200;
  mountHelper(<Calibrate />, runtime);
  expect(screen.getByText('Needs a quick redo')).toBeVisible();
  const table = screen.getByRole('table', { name: /Camera range/ });
  expect(within(table).getByRole('row', { name: /Index/ })).toHaveTextContent(
    'Your index range needs a quick redo.',
  );
  expect(
    screen.getByRole('button', { name: 'Save calibration' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: 'Redo camera range' }));
  expect(
    screen.getByRole('heading', { name: 'Step 2 · Camera range: Index' }),
  ).toBeVisible();
});
it('deep-links to the affected glove finger while retaining other saved ranges', () => {
  const runtime = helperRuntime();
  runtime.calibration.current!.servo[3].max_deg = 22;
  mountHelper(<Calibrate />, runtime, '/calibrate?step=glove&finger=ring');
  expect(
    screen.getByRole('heading', { name: 'Step 1 · Glove range: Ring' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Thumb · Set' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
  expect(screen.getByText(/Set open and closed first/)).toBeVisible();
});
it('hydrates a late backend reload even without camera frames', () => {
  vi.useFakeTimers();
  const runtime = helperRuntime();
  const calibration = runtime.calibration.current;
  runtime.calibration.current = null;
  mountHelper(<Calibrate />, runtime);
  act(() => {
    runtime.calibration.current = calibration;
    vi.advanceTimersByTime(250);
  });
  expect(
    screen.getByRole('heading', { name: 'Review your range' }),
  ).toBeVisible();
});
it('shares the amber safety strip and releases on request', () => {
  mountHelper(<Calibrate />, helperRuntime());
  const release = screen.getByRole('button', { name: 'Release glove now' });
  expect(release.closest('.ds-banner')).toHaveClass('ds-banner--warning');
  expect(release.closest('.ds-banner')).toHaveTextContent(
    'Keep your hand relaxed.Press STOP anytime. Stop if it hurts.',
  );
});

it('the single simulator shortcut saves both sources and refreshes Review', async () => {
  const runtime = helperRuntime();
  runtime.calibration.current!.camera.closed_flex.index = 200;
  const save = vi
    .spyOn(runtime.calibration, 'save')
    .mockImplementation(async (value) => {
      const saved = { ...value, id: 99, created_at: new Date().toISOString() };
      runtime.calibration.current = saved;
      return saved;
    });
  const send = vi.spyOn(runtime.calibration, 'sendToGlove');
  mountHelper(<Calibrate />, runtime);
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate simulator' }));
  expect(await screen.findByText('Simulator calibrated.')).toBeVisible();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      camera: expect.objectContaining({
        camera_view: 'front_upright',
        camera_view: 'front_upright',
        closed_flex: {
          thumb: 100,
          index: 270,
          middle: 270,
          ring: 270,
          pinky: 270,
        },
      }),
    }),
  );
  expect(send).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('button', { name: 'Save calibration' }),
  ).toBeEnabled();
  expect(screen.queryByText('Needs a quick redo')).not.toBeInTheDocument();
});

it('opens legacy calibration at the camera step with glove ranges retained', () => {
  mountHelper(<Calibrate />, legacyHelperRuntime());
  expect(
    screen.getByRole('heading', { name: 'Step 2 · Camera range' }),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Your camera range was captured in the old position. Recapture it with your hand raised.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Raise your hand, palm to the screen/)).toBeVisible();
  expect(screen.getAllByText('Not captured')).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: /Glove range/, exact: false }),
  );
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
    expect(
      screen.getByRole('button', { name: `${finger} · Set` }),
    ).toBeVisible();
});

it('saves the current camera view while preserving the existing friction curves', async () => {
  const runtime = helperRuntime();
  const friction = runtime.calibration.current!.friction;
  const save = vi
    .spyOn(runtime.calibration, 'save')
    .mockImplementation(async (value) => ({
      ...value,
      id: 100,
      created_at: new Date().toISOString(),
    }));
  mountHelper(<Calibrate />, runtime);
  fireEvent.click(screen.getByRole('button', { name: 'Save calibration' }));
  await screen.findByRole('heading', { name: 'Your range is saved' });
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      camera: expect.objectContaining({ camera_view: 'front_upright' }),
      friction,
    }),
  );
});
