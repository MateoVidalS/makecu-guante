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
import { StubVision } from './StubVision';
const makeVision = () => {
  const source: VisionSource = new StubVision();
  const store = createStore<{ latest: VisionFrame | null }>(() => ({
    latest: null,
  }));
  return {
    source,
    store,
    get latest() {
      return source.latest();
    },
    subscribe: (callback: (frame: VisionFrame) => void) =>
      source.onFrame(callback),
    setKind: async (kind: 'camera' | 'sim') => {
      if (kind === 'camera') throw new Error('Camera comes in WP3');
    },
  };
};
const Context = createContext<ReturnType<typeof makeVision> | null>(null);
export function VisionProvider({ children }: { children: ReactNode }) {
  const value = useMemo(makeVision, []);
  useEffect(() => {
    const unsub = value.source.onFrame((latest) =>
      value.store.setState({ latest }),
    );
    void value.source.start({ affectedHand: 'right' });
    return () => {
      unsub();
      value.source.stop();
    };
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useVision() {
  const value = useContext(Context);
  if (!value) throw new Error('VisionProvider is missing');
  return value;
}
export function useVisionFrame<T>(selector: (frame: VisionFrame | null) => T) {
  const { store } = useVision();
  return useStore(store, (s) => selector(s.latest));
}
