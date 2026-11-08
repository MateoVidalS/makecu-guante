import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CameraVision } from '../../vision/cameraVision';
import { rememberCalibrationDevice } from '../../vision/calibrationDevice';
import {
  mountHelper,
  resetHelperStorage,
  helperRuntime,
} from '../../components/calibration/testSupport';
import Setup from './index';
import { useGlove } from '../../glove';
import { CURRENT_SENSOR_MISSING_MESSAGE } from './CurrentSensorNotice';
import {
  CURRENT_CAMERA_VIEW,
  CURRENT_FLEX_MODEL,
} from '../../contracts/calibration';
import { Route, Routes } from 'react-router-dom';
import Calibrate from '../Calibrate';
import { PreflightGloveControls } from '../../components/common/preflightTestSupport';
import { readPracticePreflight } from '../../components/common/preflight';

/** Step 1 hides per-motor tuning in an "advanced" disclosure. */
function openAdvanced() {
  const details = screen.getByText(/Adjust each motor/).closest('details');
  if (details) details.open = true;
}

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

it('explains opening help and the normal curled resting hand', () => {
  mountHelper(<Setup />);
  expect(
    screen.getByText(/The glove helps you open your hand/),
  ).toHaveTextContent(
    'When the thread is slack, your hand may rest curled. That is normal.',
  );
  expect(
    screen.getByText(/Black guides attach to the backs of your fingers/),
  ).toHaveTextContent('Both attach directly to skin with skin-safe tape.');
});

const guideQuestion = 'Were the guides re-attached since the last calibration?';
const skinCheck =
  'Skin under the guides and threads looks normal: no redness, marks or pain';
const practiceButton = () =>
  screen.getByRole('button', { name: 'Continue to practice' });
const answerGuides = (value: 'yes' | 'no') =>
  fireEvent.change(screen.getByRole('combobox', { name: guideQuestion }), {
    target: { value },
  });
const confirmSkin = () =>
  fireEvent.click(screen.getByRole('checkbox', { name: skinCheck }));
function currentRuntime() {
  const runtime = helperRuntime();
  runtime.calibration.current!.camera.camera_view = CURRENT_CAMERA_VIEW;
  runtime.calibration.current!.camera.flex_model = CURRENT_FLEX_MODEL;
  return runtime;
}
function mountRealSetup(runtime = currentRuntime()) {
  const result = mountHelper(
    <>
      <Setup />
      <PreflightGloveControls />
    </>,
    runtime,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use real glove' }));
  return result;
}

it('requires an explicit guide answer even when the skin looks normal', () => {
  const { runtime } = mountRealSetup();
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  confirmSkin();
  expect(practiceButton()).toBeDisabled();
  expect(practiceButton()).toHaveAccessibleDescription(
    'Answer the guide question before practice.',
  );
  fireEvent.click(practiceButton());
  expect(start).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Full pull is set at straight fingers/),
  ).toHaveTextContent('A moved anchor can over-straighten a finger.');
});

it('routes re-attached guides to glove calibration and blocks practice', () => {
  const { runtime } = mountRealSetup();
  answerGuides('no');
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  confirmSkin();
  expect(readPracticePreflight()).toMatchObject({
    guidesNotReattached: true,
    skinNormal: true,
  });
  answerGuides('yes');
  expect(readPracticePreflight()).toMatchObject({
    guidesNotReattached: false,
    skinNormal: false,
  });
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/calibrate?step=glove',
  );
  expect(practiceButton()).toBeDisabled();
  expect(screen.getByRole('combobox', { name: guideQuestion })).toBeDisabled();
  expect(
    screen.getByRole('link', { name: 'Redo glove calibration' }),
  ).toHaveAttribute('href', '/calibrate?step=glove');
  fireEvent.click(practiceButton());
  expect(start).not.toHaveBeenCalled();
});

it('requires new glove ranges after re-attachment instead of reusing saved ranges', async () => {
  const runtime = currentRuntime();
  const originalCalibration = structuredClone(runtime.calibration.current);
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  mountHelper(
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/calibrate" element={<Calibrate />} />
    </Routes>,
    runtime,
    '/setup',
  );
  answerGuides('yes');
  expect(
    await screen.findByRole('heading', { name: 'Step 1 · Motors' }),
  ).toBeVisible();
  openAdvanced();
  expect(screen.getByText('Slack not set')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next finger' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Save calibration' }),
  ).not.toBeInTheDocument();
  expect(runtime.calibration.current).toEqual(originalCalibration);
  expect(start).not.toHaveBeenCalled();
});

it('requires skin confirmation after No, then starts practice through the runtime', async () => {
  const { runtime } = mountRealSetup();
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  answerGuides('no');
  expect(practiceButton()).toBeDisabled();
  expect(practiceButton()).toHaveAccessibleDescription(
    'Confirm the skin check before practice.',
  );
  expect(
    screen.getByRole('checkbox', { name: skinCheck }),
  ).toHaveAccessibleDescription(
    'Recheck the skin after the session. Stop if redness, marks or pain appear.',
  );
  confirmSkin();
  await waitFor(() => expect(practiceButton()).toBeEnabled());
  // Withdrawing the skin confirmation must close the gate again.
  confirmSkin();
  expect(practiceButton()).toBeDisabled();
  confirmSkin();
  fireEvent.click(practiceButton());
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/exercise');
});

it('keeps stale calibration blocked after the visit checks and uses its repair route', () => {
  const runtime = helperRuntime();
  runtime.calibration.current!.assist_direction = 'close';
  mountHelper(<Setup />, runtime);
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  answerGuides('no');
  confirmSkin();
  expect(practiceButton()).toBeDisabled();
  fireEvent.click(
    screen.getByRole('link', { name: 'Calibrate before practice' }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/calibrate?step=glove',
  );
  expect(start).not.toHaveBeenCalled();
});

it('persists both confirmations across Setup visits in the same tab', async () => {
  const firstVisit = mountRealSetup();
  answerGuides('no');
  confirmSkin();
  await waitFor(() => expect(practiceButton()).toBeEnabled());
  firstVisit.unmount();
  mountRealSetup(firstVisit.runtime);
  expect(screen.getByRole('combobox', { name: guideQuestion })).toHaveValue(
    'no',
  );
  expect(screen.getByRole('checkbox', { name: skinCheck })).toBeChecked();
  await waitFor(() => expect(practiceButton()).toBeEnabled());
});

it('requires new confirmations after a re-attachment calibration is saved', async () => {
  const visit = mountRealSetup();
  answerGuides('no');
  confirmSkin();
  answerGuides('yes');
  visit.unmount();
  const pendingVisit = mountRealSetup(visit.runtime);
  expect(screen.getByRole('combobox', { name: guideQuestion })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: skinCheck })).toBeDisabled();
  expect(practiceButton()).toBeDisabled();
  pendingVisit.unmount();
  visit.runtime.calibration.current = {
    ...visit.runtime.calibration.current!,
    id: 99,
  };
  mountRealSetup(visit.runtime);
  expect(screen.getByRole('combobox', { name: guideQuestion })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: skinCheck })).not.toBeChecked();
  expect(practiceButton()).toBeDisabled();
  answerGuides('no');
  confirmSkin();
  await waitFor(() => expect(practiceButton()).toBeEnabled());
});

it('allows simulated practice without the hardware safety confirmations', async () => {
  const { runtime } = mountHelper(<Setup />, currentRuntime());
  const start = vi.spyOn(runtime.exercise, 'start').mockResolvedValue();
  await waitFor(() => expect(practiceButton()).toBeEnabled());
  expect(screen.getByRole('combobox', { name: guideQuestion })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: skinCheck })).not.toBeChecked();
  fireEvent.click(practiceButton());
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
});

it('chooses what is on the hand, keeping the old glove color setting', () => {
  localStorage.setItem('rehab-hub.camera.glove-color', 'magenta');
  mountHelper(<Setup />);
  const select = screen.getByRole('combobox', { name: 'On the hand' });
  expect(select).toHaveValue('magenta-glove');
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([
    'Automatic',
    'Bare hand',
    'Violet glove',
    'Sky blue glove',
    'Magenta glove',
    'Black glove',
    'Strap device',
    'Dot points',
  ]);
  expect(select).toHaveAccessibleDescription(
    'A pink or magenta glove. Use a background that is not the glove color.',
  );
  fireEvent.change(select, { target: { value: 'strap-device' } });
  expect(select).toHaveAccessibleDescription(
    'Black straps around the finger segments, with thread guides and cables.',
  );
  expect(localStorage.getItem('rehab-hub.camera.device-profile')).toBe(
    'strap-device',
  );
  fireEvent.change(select, { target: { value: 'auto' } });
  expect(select).toHaveAccessibleDescription(/^Finds a bare hand/);
  expect(screen.queryByText(/^Calibrated with/)).not.toBeInTheDocument();
});

it('asks to redo the camera range when the device on the hand changed', async () => {
  vi.spyOn(CameraVision.prototype, 'start').mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => [] },
  });
  const runtime = currentRuntime();
  rememberCalibrationDevice(
    runtime.calibration.current!.camera,
    'violet-glove',
  );
  mountHelper(<Setup />, runtime);
  fireEvent.click(await screen.findByRole('button', { name: 'Stop camera' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Connect camera' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Connect camera' }),
    ).toBeEnabled(),
  );
  const select = screen.getByRole('combobox', { name: 'On the hand' });
  fireEvent.change(select, { target: { value: 'bare-hand' } });
  expect(
    await screen.findByText(
      'Calibrated with violet glove. Calibrate again for bare hand.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Redo camera range' }),
  ).toHaveAttribute('href', '/calibrate?step=camera');
  fireEvent.change(select, { target: { value: 'violet-glove' } });
  expect(screen.queryByText(/^Calibrated with/)).not.toBeInTheDocument();
  // Automatic says nothing until it sees the hand.
  fireEvent.change(select, { target: { value: 'auto' } });
  expect(screen.queryByText(/^Calibrated with/)).not.toBeInTheDocument();
});
