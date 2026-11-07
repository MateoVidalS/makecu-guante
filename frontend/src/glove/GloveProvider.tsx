import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  GloveClient,
  GloveTelemetry,
  GloveConnection,
  GloveEvent,
} from '../contracts/glove';
import { StubGlove } from './StubGlove';
const makeGlove = () => {
  const client: GloveClient = new StubGlove();
  const store = createStore<{
    connection: GloveConnection;
    latest: GloveTelemetry | null;
    events: GloveEvent[];
  }>(() => ({ connection: 'disconnected', latest: null, events: [] }));
  return {
    client,
    store,
    get connection() {
      return store.getState().connection;
    },
    get latest() {
      return client.latest();
    },
    get events() {
      return store.getState().events;
    },
    subscribe: client.onTelemetry.bind(client),
    setKind: async (kind: 'serial' | 'sim') => {
      if (kind === 'serial') throw new Error('Web Serial comes in WP2');
    },
  };
};
const Context = createContext<ReturnType<typeof makeGlove> | null>(null);
export function GloveProvider({ children }: { children: ReactNode }) {
  const value = useMemo(makeGlove, []);
  useEffect(() => {
    const unsub = [
      value.client.onTelemetry((latest) => value.store.setState({ latest })),
      value.client.onConnection((connection) =>
        value.store.setState({ connection }),
      ),
      value.client.onEvent((event) =>
        value.store.setState((s) => ({
          events: [...s.events, event].slice(-100),
        })),
      ),
    ];
    void value.client.connect();
    return () => {
      unsub.forEach((fn) => fn());
      void value.client.disconnect();
    };
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useGlove() {
  const value = useContext(Context);
  if (!value) throw new Error('GloveProvider is missing');
  return value;
}
export function useGloveTelemetry<T>(
  selector: (t: GloveTelemetry | null) => T,
) {
  const { store } = useGlove();
  return useStore(store, (s) => selector(s.latest));
}
