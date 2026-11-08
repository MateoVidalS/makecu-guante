import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CameraVision } from '../../vision/cameraVision';
import {
  mountHelper,
  resetHelperStorage,
} from '../../components/calibration/testSupport';
import Setup from './index';
import { useGlove } from '../../glove';
import { CURRENT_SENSOR_MISSING_MESSAGE } from './CurrentSensorNotice';

vi.mock('../../vision/CameraOverlay', () => ({
  CameraOverlay: () => <div>Camera preview</div>,
}));

beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  resetHelperStorage();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'serial');
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('keeps glove connection usable while camera model initialization is pending', async () => {
  let finishCamera!: () => void;
  const loading = new Promise<void>((resolve) => {
    finishCamera = resolve;
  });
  const cameraStart = vi
    .spyOn(CameraVision.prototype, 'start')
    .mockResolvedValue(undefined)
    .mockImplementationOnce(() => loading);
  const requestPort = vi.fn(async () => {
    throw new DOMException('No port selected', 'NotFoundError');
  });
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { getPorts: async () => [], requestPort },
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => [] },
  });
  mountHelper(<Setup />);
  fireEvent.click(await screen.findByRole('button', { name: 'Stop camera' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Connect camera' }),
  );
  await waitFor(() => expect(cameraStart).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Connect camera' })).toBeDisabled();
  const connect = screen.getByRole('button', { name: 'Reconnect glove' });
  expect(connect).toBeEnabled();
  fireEvent.click(connect);
  await waitFor(() => expect(requestPort).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Connect camera' })).toBeDisabled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No glove was selected.',
  );
  await act(async () => {
    finishCamera();
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Connect camera' }),
    ).toBeEnabled(),
  );
  expect(cameraStart).toHaveBeenCalledOnce();
});

function SensorEvents() {
  const { store } = useGlove();
  return (
    <>
      <button
        onClick={() =>
          store.setState({
            events: [
              { t: 1, e: 'boot' },
              { t: 2, e: 'ina_missing' },
            ],
          })
        }
      >
        Report missing sensor
      </button>
      <button
        onClick={() =>
          store.setState((state) => ({
            events: [...state.events, { t: 3, e: 'boot' }],
          }))
        }
      >
        Report new boot
      </button>
    </>
  );
}
it('warns about missing INA219 while retaining access to calibration', async () => {
  mountHelper(
    <>
      <Setup />
      <SensorEvents />
    </>,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Report missing sensor' }),
  );
  const notice = screen.getByText(CURRENT_SENSOR_MISSING_MESSAGE);
  expect(notice.closest('.ds-banner')).toHaveClass('ds-banner--warning');
  expect(screen.getByText('Calibration only')).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole('link', { name: 'Continue to calibration' }),
    ).toHaveAttribute('aria-disabled', 'false'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Report new boot' }));
  expect(
    screen.queryByText(CURRENT_SENSOR_MISSING_MESSAGE),
  ).not.toBeInTheDocument();
});
