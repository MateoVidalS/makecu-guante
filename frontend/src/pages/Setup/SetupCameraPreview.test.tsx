import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SetupCameraPreview } from './SetupCameraPreview';
const mock = vi.hoisted(() => ({ video: null as HTMLVideoElement | null }));
vi.mock('../../vision', () => ({
  useVision: () => ({
    source: { kind: 'camera', videoElement: () => mock.video },
  }),
}));
vi.mock('../../vision/CameraOverlay', () => ({
  CameraOverlay: () => (
    <figure>
      <div className="camera-overlay__preview" />
    </figure>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('shows the owned raw video before the model publishes its first frame', () => {
  vi.useFakeTimers();
  mock.video = null;
  const { container } = render(<SetupCameraPreview mirrored />);
  mock.video = document.createElement('video');
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelector('video')).toBe(mock.video);
  act(() => vi.advanceTimersByTime(500));
  expect(container.querySelectorAll('video')).toHaveLength(1);
});
