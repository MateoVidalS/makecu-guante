import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CoachTimeline } from './CoachTimeline';
import { FakeTherapy } from './testing/FakeTherapy';
import { attemptTherapyMarkers, canUndo } from './data';
afterEach(cleanup);
describe('therapy audit timeline', () => {
  it('interleaves decisions and feelings with elapsed time, result, source and requested/applied values', () => {
    const therapy = new FakeTherapy();
    const first = therapy.emit(
      'add_rest',
      { seconds: 30, reason: 'A longer rest.' },
      'clamped',
    );
    first.applied = { seconds: 20 };
    const rejected = therapy.emit(
      'adjust_help',
      { finger: 'unknown', reason: 'Unknown finger.' },
      'rejected',
    );
    rejected.source = 'local_rule';
    render(
      <CoachTimeline
        decisions={[rejected, first]}
        startedAt="2026-11-07T12:00:00Z"
        feelings={[
          {
            t: '2026-11-07T12:00:02Z',
            session_id: 1,
            attempt_index: 0,
            pain: 5,
            fatigue: 6,
            note: 'Sore hand.',
            source: 'voice',
          },
        ]}
      />,
    );
    const events = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(events[0]).toHaveTextContent('0:00Rest added · clamped');
    expect(events[1]).toHaveTextContent('0:02Pain 5/10 · Fatigue 6/10');
    expect(events[1]).toHaveTextContent('Voice check-in · Attempt 1');
    expect(events[2]).toHaveTextContent('rejected');
    fireEvent.click(within(events[0]).getByText('Decision details'));
    expect(events[0]).toHaveTextContent('"seconds": 30');
    expect(events[0]).toHaveTextContent('"seconds": 20');
    fireEvent.click(within(events[2]).getByText('Decision details'));
    expect(events[2]).toHaveTextContent('Local safety rule');
    expect(events[2]).toHaveTextContent('Appliednull');
  });
  it('does not offer to undo brakes, feelings, rejections or already undone adjustments', () => {
    const therapy = new FakeTherapy();
    therapy.emit('set_attempt_time', {}, 'undone');
    therapy.emit('adjust_help', {}, 'rejected');
    therapy.emit('record_feeling', {});
    therapy.brake('Pain.', 'patient_ui');
    expect(canUndo(therapy.decisions())).toBe(false);
    therapy.emit('add_rest', {});
    therapy.emit('choose_next_pose', {});
    therapy.undo();
    expect(canUndo(therapy.decisions())).toBe(true);
    therapy.undo();
    expect(canUndo(therapy.decisions())).toBe(false);
  });
  it('aligns only events within the selected attempt to its seconds axis', () => {
    const therapy = new FakeTherapy();
    therapy.emit('add_rest', {});
    therapy.emit('set_attempt_time', {});
    therapy.emit('adjust_help', {});
    expect(
      attemptTherapyMarkers(
        '2026-11-07T12:00:03Z',
        '2026-11-07T12:00:08Z',
        therapy.decisions(),
      ),
    ).toMatchObject([
      {
        t: 2,
        kind: 'decision',
        label: expect.stringContaining('Try time adjusted'),
      },
    ]);
  });
  it('shows a clear empty state for older sessions', () => {
    render(<CoachTimeline startedAt="2026-11-07T12:00:00Z" />);
    expect(
      screen.getByText('No coach decisions or feelings recorded.'),
    ).toBeVisible();
  });
});
