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
