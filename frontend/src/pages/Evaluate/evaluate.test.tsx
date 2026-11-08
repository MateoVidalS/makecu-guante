import { CURRENT_FLEX_MODEL } from '../../contracts/calibration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { GLOVE_FINGERS } from '../../contracts/glove';
import type { Calibration } from '../../contracts/calibration';
import Evaluate from './index';
import { hasCompleteFriction, hasRecentFriction } from './friction';

beforeEach(() => vi.stubEnv('VITE_SIM', '1'));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
function mount({ fresh = false } = {}) {
  const runtime = new ScriptedRuntime({ persist: false });
  runtime.calibration.current!.camera.camera_view = 'front_upright';
  runtime.calibration.current!.camera.flex_model = CURRENT_FLEX_MODEL;
  if (fresh) runtime.calibration.current!.created_at = new Date().toISOString();
  runtime.calibration.current!.camera.closed_flex = {
    thumb: 100,
    index: 270,
    middle: 270,
    ring: 270,
    pinky: 270,
  };
  const curves = structuredClone(runtime.calibration.current!.friction);
  const save = vi
    .spyOn(runtime.calibration, 'save')
    .mockImplementation(async (value) => {
      const saved: Calibration = {
        ...value,
        assist_direction: 'open',
        id: 99,
        created_at: new Date().toISOString(),
      };
      runtime.calibration.current = saved;
      return saved;
    });
  const friction = vi
    .spyOn(runtime.evaluation, 'runFriction')
    .mockResolvedValue(curves);
  const start = vi.spyOn(runtime.evaluation, 'start');
  render(
    <GloveProvider>
      <VisionProvider>
        <RuntimeProvider runtime={runtime}>
          <MemoryRouter>
            <Evaluate />
          </MemoryRouter>
        </RuntimeProvider>
      </VisionProvider>
    </GloveProvider>,
  );
  return { runtime, curves, save, friction, start };
}
async function measure() {
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Each thread is unhooked from its yellow fingertip anchor',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Measure thread friction (unhooked)' }),
  );
  await screen.findByText(
    'Recent thread friction (unhooked) saved. Re-hook each thread to its yellow fingertip anchor, then relax.',
  );
}
describe('evaluation preflight', () => {
  it('explains unhooking for friction and re-hooking before evaluation', () => {
    mount();
    expect(
      screen.getByRole('heading', {
        name: 'Measure thread friction (unhooked) first',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Unhook each thread from its yellow fingertip anchor, keep the hand relaxed, then measure friction',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Re-hook each thread to its yellow fingertip anchor before evaluating.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        /Take the glove off|Put the glove on|hanging freely|empty-glove/i,
      ),
    ).not.toBeInTheDocument();
  });
  it('asks for upright posture and a supported elbow', () => {
    mount();
    expect(
      screen.getByText(
        /Raise your hand, palm to the screen. Support your elbow and relax/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/palm down|table edge|towel/i),
    ).not.toBeInTheDocument();
  });
  it('requires unhooked-thread confirmation, saves all five friction curves, then requires a relaxed hand', async () => {
    const { curves, friction, save, runtime, start } = mount();
    expect(
      screen.getByRole('button', {
        name: 'Measure thread friction (unhooked)',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Start evaluation' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', {
        name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      }),
    ).toBeDisabled();
    await measure();
    expect(friction).toHaveBeenCalledWith([...GLOVE_FINGERS]);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ friction: curves }),
    );
    expect(
      screen.getByRole('button', { name: 'Start evaluation' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', {
        name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    runtime.dispose();
    expect(
      screen.queryByRole('button', { name: 'Stop evaluation' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Release glove now' }),
    ).toBeVisible();
  });
  it('reuses recent complete friction for a selected evaluation subset', async () => {
    const { friction, start, runtime } = mount({ fresh: true });
    expect(
      screen.queryByRole('button', {
        name: 'Measure thread friction (unhooked)',
      }),
    ).not.toBeInTheDocument();
    for (const name of ['Thumb', 'Index', 'Middle'])
      fireEvent.click(screen.getByRole('checkbox', { name }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start evaluation' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ fingers: ['ring', 'pinky'] }),
      ),
    );
    runtime.dispose();
    expect(friction).not.toHaveBeenCalled();
    act(() =>
      runtime.evaluationStore.setState({
        stage: 'sweep',
        finger: 'pinky',
        speed: 'fast',
      }),
    );
    expect(screen.getByText(/Sweep 4 of 4/)).toBeVisible();
  });
  it.each(['incomplete', 'aborted', 'save failure'] as const)(
    'keeps evaluation blocked after %s friction',
    async (reason) => {
      const { runtime, friction, save, curves } = mount();
      if (reason === 'save failure')
        save.mockRejectedValue(
          new Error('Could not save friction. Try again.'),
        );
      else
        friction.mockImplementation(async () => {
          if (reason === 'aborted')
            runtime.evaluationStore.setState({ stage: 'aborted' });
          return reason === 'incomplete' ? { thumb: curves.thumb } : curves;
        });
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'Each thread is unhooked from its yellow fingertip anchor',
        }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Measure thread friction (unhooked)',
        }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        reason === 'save failure'
          ? 'Could not save friction'
          : 'Friction measurement stopped',
      );
      expect(
        screen.getByRole('button', { name: 'Start evaluation' }),
      ).toBeDisabled();
      if (reason !== 'save failure') expect(save).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('heading', { name: 'Your evaluation' }),
      ).not.toBeInTheDocument();
    },
  );
  it('releases and stops a friction sweep from the persistent safety strip', async () => {
    const { runtime, friction } = mount();
    let finish!: (curves: Calibration['friction']) => void;
    friction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = vi.spyOn(runtime.evaluation, 'stop');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Each thread is unhooked from its yellow fingertip anchor',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Measure thread friction (unhooked)',
      }),
    );
    act(() =>
      runtime.evaluationStore.setState({
        stage: 'sweep',
        finger: 'thumb',
        speed: 'slow',
      }),
    );
    expect(
      screen.getByRole('heading', {
        name: /Measuring thread friction \(unhooked\)/,
      }),
    ).toBeVisible();
    expect(screen.getByText('Thread friction (unhooked)')).toBeVisible();
    expect(
      screen.getByText(
        'Keep each thread unhooked from its yellow fingertip anchor.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/empty and hanging freely|empty-glove/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release glove now' }));
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      runtime.evaluationStore.setState({ stage: 'aborted' });
      finish({});
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Friction measurement stopped',
    );
  });
});
it('accepts only complete, recent slow/fast baselines, including ring and pinky', () => {
  const runtime = new ScriptedRuntime({ persist: false });
  runtime.calibration.current!.camera.camera_view = 'front_upright';
  runtime.calibration.current!.camera.flex_model = CURRENT_FLEX_MODEL;
  const calibration = runtime.calibration.current!;
  calibration.created_at = new Date().toISOString();
  expect(hasCompleteFriction(calibration.friction)).toBe(true);
  expect(hasRecentFriction(calibration)).toBe(true);
  expect(
    hasRecentFriction(
      calibration,
      Date.parse(calibration.created_at) + 24 * 60 * 60 * 1000,
    ),
  ).toBe(false);
  expect(
    hasRecentFriction(calibration, Date.parse(calibration.created_at) - 1),
  ).toBe(false);
  expect(hasRecentFriction({ ...calibration, created_at: 'invalid' })).toBe(
    false,
  );
  delete calibration.friction.pinky;
  expect(hasRecentFriction(calibration)).toBe(false);
  expect(hasRecentFriction(null)).toBe(false);
});

it('blocks invalid saved calibration and links directly to the same repair', () => {
  const { runtime } = mount({ fresh: true });
  act(() => {
    runtime.calibration.current!.camera.closed_flex.index = 200;
    runtime.evaluationStore.setState({ stage: 'idle' });
  });
  expect(screen.getByText('Needs a quick redo')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Fix' })).toHaveAttribute(
    'href',
    '/calibrate?step=camera&finger=index',
  );
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Threads re-hooked to yellow fingertip anchors; hand relaxed',
    }),
  );
  expect(
    screen.getByRole('button', { name: 'Start evaluation' }),
  ).toBeDisabled();
  const strip = screen
    .getByRole('button', { name: 'Release glove now' })
    .closest('.ds-banner');
  expect(strip).toHaveClass('ds-banner--warning');
  expect(screen.getAllByText('Keep your hand relaxed.')).toHaveLength(1);
  expect(strip).toHaveTextContent('Press STOP anytime. Stop if it hurts.');
});

it('explains that the hand rests curled and the glove opens each finger', () => {
  mount();
  expect(
    screen.getByText(
      'The glove opens one finger at a time, slowly then quickly.',
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Let your hand rest curled. The glove opens one finger at a time.',
    ),
  ).toBeVisible();
});
