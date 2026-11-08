import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { VisionFrame, VisionSource } from '../contracts/vision';
import {
  CURRENT_CAMERA_VIEW,
  type CameraCalibration,
} from '../contracts/calibration';
import { createSimWorld } from '../glove/sim';
import { useGlove } from '../glove';
import { CameraVision } from './cameraVision';
import { missingFrame } from './frameProcessor';
import {
  VisionRobustnessTracker,
  type VisionRobustnessStats,
} from './robustness';

type StartOptions = Parameters<VisionSource['start']>[0];
/** Accept shared SimWorld.vision; standalone controllers own and dispose their factory-created world. */
export function createVisionController(
  options: {
    simSource?: VisionSource;
    cameraSource?: VisionSource;
    initialKind?: 'camera' | 'sim';
  } = {},
) {
  const ownedWorld = options.simSource ? null : createSimWorld();
  const sim = options.simSource ?? ownedWorld!.vision;
  const camera = options.cameraSource ?? new CameraVision();
  const initial =
    options.initialKind ??
    (import.meta.env.VITE_VISION === 'camera' ||
    import.meta.env.VITE_VISION === 'sim'
      ? import.meta.env.VITE_VISION
      : import.meta.env.VITE_SIM === '1'
        ? 'sim'
        : 'camera');
  const robustnessTracker = new VisionRobustnessTracker();
  const store = createStore<{
    source: VisionSource;
    latest: VisionFrame | null;
    error: string | null;
    robustness: VisionRobustnessStats;
  }>(() => ({
    source: initial === 'camera' ? camera : sim,
    latest: null,
    error: null,
    robustness: robustnessTracker.stats(performance.now()),
  }));
  const listeners = new Set<(frame: VisionFrame) => void>();
  let settings: StartOptions = { affectedHand: 'right' };
  let calibration: CameraCalibration | null = null;
  let detach: (() => void) | null = null;
  let generation = 0;
  const controller = {
    store,
    get source() {
      return store.getState().source;
    },
    get latest() {
      return store.getState().latest;
    },
    get error() {
      return store.getState().error;
    },
    robustness(now = performance.now()) {
      return robustnessTracker.stats(now);
    },
    subscribe(callback: (frame: VisionFrame) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async start(opts: StartOptions = settings) {
      const request = ++generation;
      settings = { ...opts, view: opts.view ?? CURRENT_CAMERA_VIEW };
      detach?.();
      detach = null;
      const source = controller.source;
      source.stop();
      robustnessTracker.reset(performance.now());
      store.setState({
        latest: null,
        error: null,
        robustness: controller.robustness(),
      });
      source.setCalibration(calibration);
      detach = source.onFrame((latest) => {
        if (request !== generation) return;
        robustnessTracker.add(
          latest,
          source instanceof CameraVision ? source.diagnostics() : undefined,
        );
        store.setState({ latest, robustness: controller.robustness(latest.t) });
        listeners.forEach((cb) => cb(latest));
      });
      try {
        await source.start(settings);
      } catch (error) {
        if (request !== generation) return;
        store.setState({
          latest: null,
          error: error instanceof Error ? error.message : 'Camera unavailable',
        });
        throw error;
      }
    },
    async setKind(kind: 'camera' | 'sim', opts?: StartOptions) {
      if (controller.source.kind === kind && !opts && kind !== 'sim') return;
      controller.stop();
      store.setState({
        source: kind === 'camera' ? camera : sim,
        latest: null,
        error: null,
      });
      await controller.start(opts ?? settings);
    },
    setCalibration(value: CameraCalibration | null) {
      if (calibration?.affected_hand !== value?.affected_hand) {
        robustnessTracker.reset(performance.now());
        store.setState({ robustness: controller.robustness() });
      }
      calibration = value;
      camera.setCalibration(value);
      sim.setCalibration(value);
      if (value) settings = { ...settings, affectedHand: value.affected_hand };
    },
    stop() {
      generation++;
      detach?.();
      detach = null;
      controller.source.stop();
      ownedWorld?.stop();
      robustnessTracker.reset();
      store.setState({ latest: null, robustness: controller.robustness() });
      const missing = missingFrame(performance.now());
      listeners.forEach((cb) => cb(missing));
    },
  };
  return controller;
}
const Context = createContext<ReturnType<typeof createVisionController> | null>(
  null,
);
type VisionProviderProps = {
  children: ReactNode;
  simSource?: VisionSource;
  initialKind?: 'camera' | 'sim';
};
export function VisionProvider(props: VisionProviderProps) {
  return props.simSource ? (
    <SourceVisionProvider {...props} />
  ) : (
    <SharedVisionProvider {...props} />
  );
}
function SharedVisionProvider(props: VisionProviderProps) {
  const { world } = useGlove();
  return <SourceVisionProvider {...props} simSource={world.vision} />;
}
function SourceVisionProvider({
  children,
  simSource,
  initialKind,
}: VisionProviderProps) {
  const value = useMemo(
    () => createVisionController({ simSource, initialKind }),
    [simSource, initialKind],
  );
  useEffect(() => {
    void value.start().catch(() => {
      /* Exposed as useVision().error for Setup. */
    });
    return () => value.stop();
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useVision() {
  const value = useContext(Context);
  if (!value) throw new Error('VisionProvider is missing');
  useStore(value.store, (s) => s.source);
  useStore(value.store, (s) => s.error);
  return value;
}
export function useVisionFrame<T>(selector: (frame: VisionFrame | null) => T) {
  const { store } = useVision();
  return useStore(store, (s) => selector(s.latest));
}

/** Reactive Setup statistics; the source kind identifies simulated checks. */
export function useVisionRobustness() {
  const { store } = useVision();
  return useStore(store, (s) => s.robustness);
}
