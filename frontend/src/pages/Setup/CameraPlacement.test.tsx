import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  CAMERA_PLACEMENT_GUIDANCE,
  type VisionRobustnessStats,
} from '../../vision/robustness';
import { CameraPlacement, GloveDetectionCheck } from './CameraPlacement';

const mock = vi.hoisted(() => ({
  running: true,
  kind: 'camera',
  robustness: vi.fn(),
}));
vi.mock('../../vision', () => ({
  useVision: () => controller,
  useVisionFrame: () => mock.running,
}));
const controller = {
  source: {
    get kind() {
      return mock.kind;
    },
  },
  robustness: mock.robustness,
};
const stats = (
  patch: Partial<VisionRobustnessStats> = {},
): VisionRobustnessStats => ({
  windowMs: 5000,
  observedMs: 5000,
  samples: 150,
  detectionRate: 0.92,
  meanConfidence: 0.85,
  perFingerVisibility: {
    thumb: 0.95,
    index: 0.94,
    middle: 0.92,
    ring: 0.91,
    pinky: 0.9,
  },
  status: 'ready',
  guidance: ['Check that the skeleton follows every finger.'],
  ...patch,
});
beforeEach(() => {
  vi.useFakeTimers();
  mock.running = true;
  mock.kind = 'camera';
  mock.robustness.mockReturnValue(stats());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('camera placement and glove check', () => {
  it('describes upright webcam framing, elbow support and lighting', () => {
    render(<CameraPlacement />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /Raised hand beside the face.*palm to the laptop screen.*elbow.*40–60 cm/,
    );
    expect(screen.getByText(/Raise your hand beside your face/)).toBeVisible();
    expect(screen.getByText(/Avoid a bright window behind you/)).toBeVisible();
    expect(
      screen.queryByText(/palm down|towel|table edge/i),
    ).not.toBeInTheDocument();
  });
  it('shows detection percentage and all five finger visibility estimates', () => {
    render(<GloveDetectionCheck />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Hand detected: 92% of the last 5 s',
    );
    expect(screen.getByText('Tracking looks steady.')).toBeVisible();
    expect(screen.getByText(/Lighting check/)).toBeVisible();
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
      expect(screen.getByText(finger)).toBeInTheDocument();
  });
  it('polls when frames stop, replacing ready status with poor tracking guidance', () => {
    render(<GloveDetectionCheck />);
    mock.robustness.mockReturnValue(
      stats({
        status: 'poor',
        detectionRate: 0.1,
        guidance: ['Improve lighting. Use a light, thin glove.'],
      }),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole('status')).toHaveTextContent('10%');
    expect(screen.getByText('Tracking needs adjustment.')).toBeVisible();
    expect(screen.getByText(/Improve lighting/)).toBeVisible();
  });
  it('labels simulator estimates and collects a full five-second window', () => {
    mock.kind = 'sim';
    mock.robustness.mockReturnValue(
      stats({ status: 'collecting', observedMs: 1200 }),
    );
    render(<GloveDetectionCheck />);
    expect(screen.getByText(/Simulator check/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('1.2 of 5 s');
  });
  it('uses upright placement while the shared vision guidance is being updated', () => {
    mock.robustness.mockReturnValue(
      stats({ status: 'poor', guidance: [CAMERA_PLACEMENT_GUIDANCE] }),
    );
    render(<GloveDetectionCheck />);
    expect(screen.getByText(/Raise your hand beside your face/)).toBeVisible();
    expect(
      screen.queryByText(/palm down|table edge|towel/i),
    ).not.toBeInTheDocument();
  });
  it('asks for the camera when stopped', () => {
    mock.running = false;
    render(<GloveDetectionCheck />);
    expect(screen.getByRole('status')).toHaveTextContent('Connect the camera');
    expect(
      screen.queryByText('Tracking looks steady.'),
    ).not.toBeInTheDocument();
  });
  it.each([
    ['backlit', 'Your hand is in shadow.', /Close the curtain behind you/],
    ['low_light', 'Your hand needs more light.', /Add a light in front/],
  ] as const)('warns from V1 lighting stats: %s', (status, title, guidance) => {
    render(<GloveDetectionCheck />);
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    mock.robustness.mockReturnValue(
      stats({
        status: 'poor',
        lighting: {
          status,
          meanLuminance: 0.2,
          handLuminance: 0.1,
          backgroundLuminance: 0.6,
        },
      }),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(guidance)).toBeVisible();
    mock.robustness.mockReturnValue(stats());
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
  });
  it.each(['sim', 'stopped'])(
    'does not show stale exposure warnings for %s',
    (source) => {
      mock.kind = source === 'sim' ? 'sim' : 'camera';
      mock.running = source !== 'stopped';
      mock.robustness.mockReturnValue(
        stats({
          lighting: {
            status: 'backlit',
            meanLuminance: 0.4,
            handLuminance: 0.1,
            backgroundLuminance: 0.6,
          },
        }),
      );
      render(<GloveDetectionCheck />);
      expect(
        screen.queryByText('Your hand is in shadow.'),
      ).not.toBeInTheDocument();
    },
  );
});
