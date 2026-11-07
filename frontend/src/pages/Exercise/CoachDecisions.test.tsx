import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CoachDecisions } from './CoachDecisions';
import { FakeTherapy } from '../../components/therapy/testing/FakeTherapy';
afterEach(cleanup);
function mount() {
  const therapy = new FakeTherapy();
  const view = render(
    <CoachDecisions
      therapy={therapy}
      sessionId={1}
      onBrake={() => therapy.brake('Patient asked.', 'patient_ui')}
    />,
  );
  return { therapy, ...view };
}
describe('patient therapy controls', () => {
  it('subscribes to decisions, shows rejection and reason, and undoes adjustments only', () => {
    const { therapy } = mount();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeDisabled();
    act(() => {
      therapy.emit('adjust_help', {
        finger: 'ring',
        direction: 'less',
        reason: 'A slower pace.',
      });
    });
    expect(undo).toBeEnabled();
    expect(
      screen.getByText(/Help starts later · ring.*A slower pace/),
    ).toBeVisible();
    fireEvent.click(undo);
    expect(therapy.undos).toBe(1);
    expect(undo).toBeDisabled();
    act(() => {
      therapy.emit(
        'adjust_help',
        { reason: 'Already adjusted this attempt.' },
        'rejected',
      );
    });
    expect(screen.getByText(/rejected.*Already adjusted/)).toBeVisible();
    expect(undo).toBeDisabled();
    act(() => {
      therapy.brake('Rest now.', 'local_rule');
    });
    expect(undo).toBeDisabled();
  });
  it('records both chosen scores once and immediately reaches the runtime pain policy', () => {
    const { therapy } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'How I feel' }));
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Fatigue from 0 to 10' }),
      ).getByRole('button', { name: '6' }),
    );
    expect(therapy.feelings()).toHaveLength(0);
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Pain from 0 to 10' }),
      ).getByRole('button', { name: '5' }),
    );
    expect(therapy.feelings()).toMatchObject([
      { fatigue: 6, pain: 5, source: 'ui' },
    ]);
    expect(therapy.brakes).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Glove released. Practice paused.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
  it('keeps Brake inside the check-in and dismisses the dialog on a coach brake', () => {
    const { therapy } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'How I feel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brake' }));
    expect(therapy.brakes).toBe(1);
    expect(therapy.feelings()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'How I feel' }));
    act(() => {
      therapy.brake('Stop words.', 'local_rule');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows a rejected feeling inside the check-in and keeps Brake available', () => {
    const { therapy } = mount();
    vi.spyOn(therapy, 'recordFeeling').mockImplementation(() =>
      therapy.emit(
        'record_feeling',
        { reason: 'Please start practice first.' },
        'rejected',
        'patient_ui',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'How I feel' }));
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Fatigue from 0 to 10' }),
      ).getByRole('button', { name: '6' }),
    );
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Pain from 0 to 10' }),
      ).getByRole('button', { name: '5' }),
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('alert'),
    ).toHaveTextContent('Please start practice first.');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Brake' }),
    ).toBeEnabled();
    expect(therapy.brakes).toBe(0);
  });
  it('does not invent feelings when cancelled or when the runtime is unavailable', () => {
    const { therapy, rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'How I feel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(therapy.feelings()).toHaveLength(0);
    rerender(<CoachDecisions sessionId={2} onBrake={() => {}} />);
    expect(screen.getByRole('button', { name: 'How I feel' })).toBeDisabled();
    expect(
      screen.getByText('Coach adjustments are unavailable.'),
    ).toBeVisible();
  });
});
