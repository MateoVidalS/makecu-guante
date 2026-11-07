import type { ReactNode } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuntimeProvider } from '../../runtime';
import { ScriptedRuntime } from '../../runtime/ScriptedRuntime';
import { GloveProvider } from '../../glove';
import { VisionProvider } from '../../vision';
import { VoiceProvider } from '../../voice';
import { DEFAULT_EXERCISE_SETTINGS } from '../../contracts/poses';
import Exercise, { LiveStage } from './index';

vi.mock('../../hand3d/VirtualHand', () => ({
  VirtualHand: () => <div>Hand preview</div>,
}));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
beforeEach(() => {
  vi.stubEnv('VITE_SIM', '1');
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
function mount(
  children: ReactNode,
  runtime = new ScriptedRuntime({ persist: false }),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GloveProvider>
        <VisionProvider>
          <RuntimeProvider runtime={runtime}>
            <VoiceProvider>
              <MemoryRouter>{children}</MemoryRouter>
            </VoiceProvider>
          </RuntimeProvider>
        </VisionProvider>
      </GloveProvider>
    </QueryClientProvider>,
  );
  return runtime;
}

describe('live stage', () => {
  it('shows the virtual hand and the camera side by side, with a bare camera overlay', () => {
    mount(<LiveStage />);
    const stage = document.querySelector('.live-stage')!;
    expect(stage).toHaveAttribute('data-camera', 'shown');
    const panels = stage.querySelectorAll(':scope > .live-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveAccessibleName('Target and your hand');
    expect(panels[1]).toHaveAccessibleName('Camera');
    expect(screen.getByText('Hand preview')).toBeInTheDocument();
    const overlay = screen.getByRole('figure', { name: 'Hand camera preview' });
    expect(overlay).toHaveClass('camera-overlay--bare');
    // Bare mode drops the framing guide and the finger read-out.
    expect(overlay.querySelector('.camera-overlay__guide')).toBeNull();
    expect(overlay.querySelector('figcaption')).toBeNull();
    expect(
      overlay.querySelector('.camera-overlay__preview--mirrored'),
    ).not.toBeNull();
  });
  it('hides the camera with a small toggle and remembers the choice', () => {
    mount(<LiveStage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show camera' }));
    expect(document.querySelector('.live-stage')).toHaveAttribute(
      'data-camera',
      'hidden',
    );
    expect(
      screen.queryByRole('figure', { name: 'Hand camera preview' }),
    ).toBeNull();
    expect(localStorage.getItem('rehab-hub.exercise.camera')).toBe('hidden');
    cleanup();
    mount(<LiveStage />);
    const toggle = screen.getByRole('switch', { name: 'Show camera' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(
      screen.getByRole('figure', { name: 'Hand camera preview' }),
    ).toBeInTheDocument();
  });
  it('keeps Pause as the first control of the live hero (tab order and QA probes)', async () => {
    const runtime = new ScriptedRuntime({ persist: false });
    await runtime.exercise.start(
      [{ pose: 'full_fist', reps: 1 }],
      DEFAULT_EXERCISE_SETTINGS,
    );
    runtime.dispose();
    mount(<Exercise />, runtime);
    await waitFor(() =>
      expect(document.querySelector('.live-hero')).not.toBeNull(),
    );
    expect(document.querySelector('.live-hero button')).toHaveTextContent(
      'Pause',
    );
    expect(document.querySelector('.live-hero .live-stage')).not.toBeNull();
    // The old picture-in-picture camera is gone from the side column.
    expect(document.querySelector('.live-details .camera-overlay')).toBeNull();
  });
});
