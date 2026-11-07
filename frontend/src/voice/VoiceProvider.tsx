import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createVoiceToken, getSessions, addTranscript } from '../api/client';
import { useRuntime } from '../runtime';
import {
  VoiceController,
  browserVoiceDependencies,
  type VoiceDependencies,
} from './VoiceController';
export type { VoiceStatus } from './VoiceController';
const Context = createContext<VoiceController | null>(null);
export function VoiceProvider({
  children,
  dependencies,
}: {
  children: ReactNode;
  dependencies?: VoiceDependencies;
}) {
  const runtime = useRuntime();
  const [controller, setController] = useState<VoiceController | null>(null);
  useEffect(() => {
    const value = new VoiceController(
      runtime,
      dependencies ?? {
        token: createVoiceToken,
        sessions: () => getSessions(),
        save: (id, lines) => addTranscript({ id, lines }),
        transport: browserVoiceDependencies.transport,
        audio: browserVoiceDependencies.audio(),
        local: browserVoiceDependencies.local(),
      },
    );
    setController(value);
    return () => value.dispose();
  }, [runtime, dependencies]);
  // Children mount only after the subscription exists; StrictMode cleanup is safe.
  if (!controller) return null;
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useVoice() {
  const controller = useContext(Context);
  if (!controller) throw new Error('VoiceProvider is missing');
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return {
    ...state,
    start: (id: number | null) => controller.start(id),
    stop: () => controller.stop(),
    setMode: (mode: 'live' | 'simple' | 'off') => controller.setMode(mode),
    setMuted: (muted: boolean) => controller.setMuted(muted),
  };
}
