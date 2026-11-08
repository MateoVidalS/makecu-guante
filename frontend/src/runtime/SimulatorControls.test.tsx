import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { PATIENT_PRESETS } from '../glove/sim/patient';
import {
  RuntimeSimulatorCalibration,
  RuntimeSimulatorControls,
} from './SimulatorControls';
const mocks = vi.hoisted(() => ({
  setPreset: vi.fn(),
  save: vi.fn().mockResolvedValue({}),
}));
vi.mock('../glove', () => ({
  useGlove: () => ({
    client: { kind: 'sim' },
    world: {
      patient: { preset: 'moderate', rigid: {} },
      controls: { setPreset: mocks.setPreset },
    },
  }),
}));
vi.mock('../vision', () => ({
  useVision: () => ({ source: { kind: 'sim' } }),
}));
vi.mock('./RuntimeProvider', () => ({
  useRuntime: () => ({ calibration: { save: mocks.save } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('offers the five opening presets, starts on moderate and falls back for unmerged presets', () => {
  render(<RuntimeSimulatorControls />);
  const select = screen.getByRole('combobox', { name: 'Patient preset' });
  expect(select).toHaveValue('moderate');
  for (const id of ['demo', 'mild', 'moderate', 'spastic', 'rigid_index']) {
    const option = select.querySelector(`option[value="${id}"]`)!;
    expect(option).toBeInTheDocument();
    expect(option).toHaveProperty('disabled', !(id in PATIENT_PRESETS));
  }
  fireEvent.change(select, { target: { value: 'spastic' } });
  expect(mocks.setPreset).toHaveBeenCalledWith(
    'spastic' in PATIENT_PRESETS ? 'spastic' : 'moderate',
  );
});
it('marks the runtime simulator shortcut as opening assistance', async () => {
  render(
    <MemoryRouter>
      <RuntimeSimulatorCalibration />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate simulator' }));
  await screen.findByText('Simulator calibrated.');
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      assist_direction: 'open',
      camera: expect.objectContaining({ camera_view: 'front_upright' }),
    }),
  );
});
