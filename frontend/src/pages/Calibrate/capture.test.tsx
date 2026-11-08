import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GloveEvent, GloveTelemetry, Quint } from '../../contracts/glove';
import type { VisionFrame } from '../../contracts/vision';
import { CURRENT_FLEX_MODEL } from '../../contracts/calibration';
import { calibration as fixture } from '../../contracts/fixtures.check';
import { MAX_ASSIST_PULL } from '../../contracts/poses';
import { freshDraft, saveDraft } from './draft';
import Calibrate from './index';

/** Step 1 hides per-motor tuning in an "advanced" disclosure. */
function openAdvanced() {
  const details = screen.getByText(/Adjust each motor/).closest('details');
  if (details) details.open = true;
}

const state = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  vision: {} as Record<string, unknown>,
  runtime: {} as Record<string, unknown>,
}));
vi.mock('../../glove', () => ({
  useGlove: () => ({
    client: state.client,
    store: {
      getState: () => ({ client: state.client, connection: 'connected' }),
    },
  }),
  useGloveTelemetry: () => 0,
}));
vi.mock('../../vision', () => ({
  useVision: () => state.vision,
  useVisionFrame: () => true,
}));
vi.mock('../../vision/CameraOverlay', () => ({ CameraOverlay: () => <div /> }));
vi.mock('../../runtime', () => ({ useRuntime: () => state.runtime }));
vi.mock('../../runtime/calibrationValidation', async (original) => ({
  ...(await original<typeof import('../../runtime/calibrationValidation')>()),
  useSavedCalibration: () =>
    (state.runtime.calibration as { current: unknown }).current,
  useCalibrationStatus: () => ({ state: 'ok', issues: [] }),
}));

let telemetry: GloveTelemetry;
let frame: VisionFrame;
let frameListener: ((frame: VisionFrame) => void) | undefined;
let eventListener: ((event: GloveEvent) => void) | undefined;
let target: ReturnType<typeof vi.fn>;
let release: ReturnType<typeof vi.fn>;
let calls: string[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  sessionStorage.clear();
  saveDraft(freshDraft());
  calls = [];
  telemetry = {
    t: 0,
    ms: 0,
    a: [0, 0, 0, 0, 0],
    tg: null,
    ma: 100,
    st: 'idle',
    md: 'none',
  };
  frame = {
    t: 0,
    detected: true,
    confidence: 1,
    handedness: 'right',
    closure: null,
    rawFlexSum: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    joints: null,
    pinch: 1,
    landmarks: null,
  };
  target = vi.fn((f: Quint) => {
    telemetry.a = [...f];
    calls.push('target');
  });
  release = vi.fn(() => {
    calls.push('release');
  });
  state.client = {
    kind: 'serial',
    connection: () => 'connected',
    latest: () => telemetry,
    release,
    target,
    limit: vi.fn(),
    jog: vi.fn(() => calls.push('jog')),
    calib: vi.fn(() => calls.push('calib')),
    onEvent: (cb: typeof eventListener) => {
      eventListener = cb;
      return () => {};
    },
    onError: () => () => {},
    onConnection: () => () => {},
  };
  state.vision = {
    source: {
      kind: 'camera',
      onFrame: (cb: typeof frameListener) => {
        frameListener = cb;
        return () => {
          frameListener = undefined;
        };
      },
    },
    latest: frame,
    start: vi.fn().mockResolvedValue(undefined),
    setCalibration: vi.fn(),
  };
  state.runtime = {
    calibration: {
      current: {
        ...fixture,
        assist_direction: 'open',
        camera: {
          ...fixture.camera,
          camera_view: 'front_upright',
          flex_model: CURRENT_FLEX_MODEL,
        },
      },
    },
    evaluation: { stop: vi.fn().mockResolvedValue(undefined) },
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function mount(step = 'camera') {
  render(
    <MemoryRouter initialEntries={[`/calibrate?step=${step}&finger=pinky`]}>
      <Calibrate />
    </MemoryRouter>,
  );
}
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50)
    act(() => {
      vi.advanceTimersByTime(50);
      frameListener?.({ ...frame, t: performance.now() });
    });
}
it('captures an active fist without any motor target', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Capture my fist' }));
  advance(2300);
  expect(target).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Glove opens the hand' }),
  ).toBeEnabled();
});
it('stages opening pull at no more than 0.3/s, caps it and releases after capture', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Glove opens the hand' }));
  advance(3300);
  expect(target).toHaveBeenCalledTimes(5);
  const vectors = target.mock.calls.map(([f]) => f as Quint);
  expect(vectors[0]).toEqual([MAX_ASSIST_PULL, 0, 0, 0, 0]);
  expect(vectors[4]).toEqual(Array(5).fill(MAX_ASSIST_PULL));
  expect(
    target.mock.calls.every(
      ([f, speed]) =>
        speed <= 0.3 && f.every((p: number) => p <= MAX_ASSIST_PULL),
    ),
  ).toBe(true);
  expect(calls.at(-1)).toBe('release');
});
it.each(['overcurrent', 'stop_button', 'watchdog'] as const)(
  'aborts opening on %s without restarting targets',
  (e) => {
    mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'Glove opens the hand' }),
    );
    advance(100);
    act(() => eventListener?.({ t: performance.now(), e, ma: 1501 }));
    const count = target.mock.calls.length;
    advance(5000);
    expect(target).toHaveBeenCalledTimes(count);
    expect(calls.at(-1)).toBe('release');
    expect(screen.getByRole('alert')).toHaveTextContent('Glove stopped');
  },
);
it('stops a loaded opening that no longer makes progress', () => {
  mount();
  telemetry.ma = 1400;
  fireEvent.click(screen.getByRole('button', { name: 'Glove opens the hand' }));
  advance(1200);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Resistance while opening',
  );
  const count = target.mock.calls.length;
  advance(5000);
  expect(target).toHaveBeenCalledTimes(count);
  expect(calls.at(-1)).toBe('release');
});
it('uses the patient’s own open hand with a simulated glove and real camera', () => {
  state.client.kind = 'sim';
  mount();
  expect(
    screen.getByText('Open your own hand, fingers straight. Hold it still.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Capture open hand' }));
  advance(2300);
  expect(target).not.toHaveBeenCalled();
});
it('shows Slack then Open, warns about hyperextension, and releases before calib', () => {
  mount('glove');
  openAdvanced();
  expect(
    screen.getByText(/First check the range on a mannequin or helper hand/),
  ).toBeVisible();
  const slack = screen.getByRole('button', { name: 'Set slack' });
  const open = screen.getByRole('button', { name: 'Set open' });
  expect(
    slack.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(open).toHaveAccessibleDescription(/Hyperextension warning/);
  fireEvent.click(screen.getByRole('button', { name: '+1°' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to camera range' }),
  );
  expect(calls.slice(-7)).toEqual([
    'jog',
    'release',
    'calib',
    'calib',
    'calib',
    'calib',
    'calib',
  ]);
});
/** Like advance, with the frame at each 50 ms tick chosen by elapsed time. */
function advanceWith(
  ms: number,
  at: (elapsed: number) => Partial<VisionFrame>,
) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50)
    act(() => {
      vi.advanceTimersByTime(50);
      frameListener?.({ ...frame, ...at(elapsed), t: performance.now() });
    });
}
const alertText = () => screen.queryByRole('alert')?.textContent ?? '';
const missed = {
  detected: false,
  confidence: 0,
  handedness: null,
  rawFlexSum: null,
  pinch: null,
} as const;
it('keeps a capture through a short detection gap', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Capture my fist' }));
  advanceWith(2300, (t) => (t >= 900 && t < 1000 ? missed : {}));
  expect(alertText()).toBe('');
  expect(
    screen.getByRole('button', { name: 'Glove opens the hand' }),
  ).toBeEnabled();
});
it('cancels and releases when the hand is lost for 200 ms', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Capture my fist' }));
  advanceWith(2300, (t) => (t >= 900 && t < 1200 ? missed : {}));
  expect(screen.getByRole('alert')).toHaveTextContent('Keep your hand in view');
  expect(calls.at(-1)).toBe('release');
});
it('refuses a hand that keeps closing during the hold', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Capture my fist' }));
  advanceWith(2300, (t) => ({
    rawFlexSum: { thumb: 0, index: t / 50, middle: 0, ring: 0, pinky: 0 },
  }));
  expect(screen.getByRole('alert')).toHaveTextContent('Too much movement');
});
// The glove drives the hand while it opens it and while it holds it open: the
// page's stall check needs vision, so any missed frame cancels and releases
// (relaxing this needs a hardware check). Only passive captures tolerate gaps.
it('cancels and releases the glove opening on a single missed frame', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Glove opens the hand' }));
  advance(200);
  const before = target.mock.calls.length;
  expect(before).toBeGreaterThan(0);
  advanceWith(50, () => missed);
  expect(screen.getByRole('alert')).toHaveTextContent('Keep your hand in view');
  expect(calls.at(-1)).toBe('release');
  advance(3000);
  expect(target).toHaveBeenCalledTimes(before);
  expect(calls.at(-1)).toBe('release');
});
it('cancels and releases on a missed frame while the glove holds the hand open', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Glove opens the hand' }));
  // Opening ends and the 2.1 s hold starts within 1.2 s (the capture ends by 3.3 s).
  advance(2500);
  expect(target).toHaveBeenCalledTimes(5);
  expect(alertText()).toBe('');
  advanceWith(50, () => missed);
  expect(screen.getByRole('alert')).toHaveTextContent('Keep your hand in view');
  expect(calls.at(-1)).toBe('release');
});
it('keeps a passive own-hand open capture through a short detection gap', () => {
  state.client.kind = 'sim';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Capture open hand' }));
  advanceWith(2300, (t) => (t >= 900 && t < 1000 ? missed : {}));
  expect(alertText()).toBe('');
  expect(target).not.toHaveBeenCalled();
});
