import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualHandProps } from '../../hand3d';
import { POSES } from '../../contracts/poses';
import DevHand from './index';

let hand: VirtualHandProps;
vi.mock('../../hand3d', () => ({
  VirtualHand: (props: VirtualHandProps) => {
    hand = props;
    return <div data-testid="hand" />;
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hand gallery', () => {
  it('offers four states side by side for every pose and a grayscale toggle', () => {
    render(<DevHand />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare states' }));
    expect(screen.getAllByTestId('hand')).toHaveLength(5);
    for (const pose of Object.values(POSES)) {
      fireEvent.click(screen.getByRole('button', { name: pose.name }));
      expect(
        screen.getByRole('group', { name: `${pose.name} state comparison` }),
      ).toBeDefined();
      for (const name of [
        'Resting',
        'Moving alone',
        'Glove helping',
        'Reached',
      ])
        expect(screen.getByRole('heading', { name })).toBeDefined();
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grayscale' }));
    expect(
      screen
        .getByRole('heading', { name: 'Virtual hand gallery' })
        .closest('section')?.dataset.grayscale,
    ).toBe('true');
  });
  it('offers all six targets, per-joint controls, mirroring and per-finger states', () => {
    render(<DevHand />);
    for (const pose of Object.values(POSES))
      expect(screen.getByRole('button', { name: pose.name })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Hook' }));
    expect(hand!.target).toBe(POSES.hook.render);
    fireEvent.click(screen.getByRole('button', { name: 'Match target' }));
    expect(hand!.actual()).toEqual(POSES.hook.render);
    fireEvent.change(screen.getByRole('slider', { name: 'Index PIP' }), {
      target: { value: '43' },
    });
    expect(hand!.actual()!.index.pip).toBe(43);
    expect(POSES.hook.render.index.pip).toBe(90);
    fireEvent.change(screen.getByRole('combobox', { name: 'Affected hand' }), {
      target: { value: 'left' },
    });
    expect(hand!.handedness).toBe('left');
    fireEvent.change(screen.getByRole('combobox', { name: 'Index state' }), {
      target: { value: 'reached' },
    });
    expect(hand!.state('index')).toBe('reached');
    for (const finger of ['Ring', 'Pinky']) {
      fireEvent.change(
        screen.getByRole('combobox', { name: `${finger} state` }),
        {
          target: { value: 'assist' },
        },
      );
      expect(hand!.state(finger.toLowerCase() as 'ring' | 'pinky')).toBe(
        'assist',
      );
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hand visible' }));
    expect(hand!.actual()).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show target' }));
    expect(hand!.target).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reduced motion' }));
    expect(hand!.reducedMotion).toBe(true);
  });
  it('updates a reusable joint sample at 30 Hz and releases the timer', () => {
    vi.useFakeTimers();
    const { unmount } = render(<DevHand />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: '30 Hz stub vision' }),
    );
    act(() => vi.advanceTimersByTime(34));
    const sample = hand!.actual();
    act(() => vi.advanceTimersByTime(1000));
    expect(hand!.actual()).toBe(sample);
    expect(
      Number(screen.getByLabelText('Stub frames').textContent),
    ).toBeGreaterThanOrEqual(30);
    expect(
      (screen.getByRole('slider', { name: 'Index PIP' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases camera tracks when its pending request finishes after unmount', async () => {
    const stop = vi.fn();
    let resolve!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { unmount } = render(<DevHand />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    unmount();
    await act(async () =>
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream),
    );
    expect(stop).toHaveBeenCalledOnce();
  });
});
