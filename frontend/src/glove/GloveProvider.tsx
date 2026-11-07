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
import type { Unsubscribe } from '../contracts/runtime';
import { WebSerialGlove } from './webSerialGlove';
import { SimWorld } from './sim/simWorld';

export function createGloveController(
  options: {
    kind?: 'serial' | 'sim';
    world?: SimWorld;
    serial?: GloveClient;
  } = {},
) {
  const world =
    options.world ??
    new SimWorld({ timeScale: Number(import.meta.env.VITE_SIM_SPEED ?? 1) });
  const serial = options.serial ?? new WebSerialGlove();
  const kind =
    options.kind ?? (import.meta.env.VITE_SIM === '1' ? 'sim' : 'serial');
  const initial = kind === 'sim' ? world.glove : serial;
  const store = createStore<{
    client: GloveClient;
    connection: GloveConnection;
    latest: GloveTelemetry | null;
    events: GloveEvent[];
  }>(() => ({
    client: initial,
    connection: initial.connection(),
    latest: initial.latest(),
    events: [],
  }));
  let unsub: Unsubscribe[] = [];
  let mounted = false;
  let switchTask = Promise.resolve();
  const bind = (client: GloveClient) => {
    unsub.forEach((fn) => fn());
    unsub = [
      client.onTelemetry((latest) => store.setState({ latest })),
      client.onConnection((connection) =>
        store.setState({
          connection,
          ...(connection === 'disconnected' ? { latest: null } : {}),
        }),
      ),
      client.onEvent((event) =>
        store.setState((s) => ({ events: [...s.events, event].slice(-100) })),
      ),
    ];
  };
  return {
    world,
    store,
    get client() {
      return store.getState().client;
    },
    get connection() {
      return store.getState().connection;
    },
    get latest() {
      return store.getState().latest;
    },
    get events() {
      return store.getState().events;
    },
    subscribe: (cb: (t: GloveTelemetry) => void) =>
      store.subscribe((state, previous) => {
        if (state.latest && state.latest !== previous.latest) cb(state.latest);
      }),
    subscribeTelemetry: <T,>(
      selector: (t: GloveTelemetry | null) => T,
      cb: (value: T) => void,
    ) => {
      let previous = selector(store.getState().latest);
      return store.subscribe((state) => {
        const next = selector(state.latest);
        if (!Object.is(next, previous)) {
          previous = next;
          cb(next);
        }
      });
    },
    setKind(nextKind: 'serial' | 'sim') {
      switchTask = switchTask.then(async () => {
        const previous = store.getState().client;
        if (previous.kind === nextKind) return;
        await previous.disconnect();
        const client = nextKind === 'sim' ? world.glove : serial;
        if (mounted) bind(client);
        store.setState({
          client,
          connection: client.connection(),
          latest: client.latest(),
          events: [],
        });
        if (mounted && nextKind === 'sim') await client.connect();
      });
      // Keep subsequent switches usable after an unexpected transport error.
      const result = switchTask;
      switchTask = switchTask.catch(() => {});
      return result;
    },
    mount() {
      mounted = true;
      bind(store.getState().client);
      if (store.getState().client.kind === 'sim')
        void store.getState().client.connect();
    },
    dispose() {
      mounted = false;
      unsub.forEach((fn) => fn());
      unsub = [];
      void store.getState().client.disconnect();
      world.stop();
    },
  };
}
const Context = createContext<ReturnType<typeof createGloveController> | null>(
  null,
);
export function GloveProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => createGloveController(), []);
  useEffect(() => {
    value.mount();
    return () => value.dispose();
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useController() {
  const value = useContext(Context);
  if (!value) throw new Error('GloveProvider is missing');
  return value;
}
export function useGlove() {
  const value = useController();
  useStore(value.store, (s) => s.client);
  useStore(value.store, (s) => s.connection);
  useStore(value.store, (s) => s.events);
  return value;
}
export function useGloveTelemetry<T>(
  selector: (t: GloveTelemetry | null) => T,
) {
  const { store } = useController();
  return useStore(store, (s) => selector(s.latest));
}
