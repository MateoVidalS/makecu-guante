import { createContext, useContext, useMemo, type ReactNode } from 'react';
export type VoiceStatus = 'off' | 'listening' | 'speaking' | 'fallback';
const Context = createContext<{
  status: VoiceStatus;
  mode: 'off' | 'simple' | 'live';
  setMode(mode: 'off' | 'simple' | 'live'): void;
  muted: boolean;
  lastCoachLine: string | null;
  lastPatientLine: string | null;
  start(sessionId: number | null): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
} | null>(null);
export function VoiceProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      status: 'off' as const,
      mode: 'off' as const,
      setMode: (_mode: 'off' | 'simple' | 'live') => {},
      muted: true,
      lastCoachLine: null,
      lastPatientLine: null,
      start: async (_sessionId: number | null) => {},
      stop: () => {},
      setMuted: (_muted: boolean) => {},
    }),
    [],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useVoice() {
  const value = useContext(Context);
  if (!value) throw new Error('VoiceProvider is missing');
  return value;
}
