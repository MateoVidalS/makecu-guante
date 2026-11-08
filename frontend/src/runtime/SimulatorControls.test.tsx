import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { CURRENT_FLEX_MODEL } from '../contracts/calibration';
import { PATIENT_PRESET_OPTIONS } from '../glove/sim/patient';
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
beforeEach(() => {
  mocks.save.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('offers the real opening presets and starts on moderate', () => {
  render(<RuntimeSimulatorControls />);
  const select = screen.getByRole('combobox', { name: 'Patient preset' });
  expect(select).toHaveValue('moderate');
  expect(select.querySelectorAll('option')).toHaveLength(5);
  for (const { id, label } of PATIENT_PRESET_OPTIONS) {
    const option = screen.getByRole('option', { name: label });
    expect(option).toHaveValue(id);
    expect(option).toBeEnabled();
    fireEvent.change(select, { target: { value: id } });
    expect(mocks.setPreset).toHaveBeenLastCalledWith(id);
  }
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
      camera: expect.objectContaining({
        camera_view: 'front_upright',
        flex_model: CURRENT_FLEX_MODEL,
      }),
    }),
  );
});
