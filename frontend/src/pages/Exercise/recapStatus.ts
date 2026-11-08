export type SavingState = 'Saving…' | 'Saved' | 'Offline';

/**
 * The line under the session recap. Every state resolves: saving, saved with the coach's
 * words, saved without them, or not saved because the server is unreachable (the queue
 * keeps retrying, so the patient is told it saves by itself).
 */
export function recapStatus({
  saving,
  fetching,
  text,
  failed,
}: {
  saving: SavingState;
  fetching: boolean;
  text?: string | null;
  failed: boolean;
}): { kind: 'coach' | 'status'; text: string } | null {
  if (fetching) return { kind: 'status', text: 'Preparing your recap…' };
  if (text) return { kind: 'coach', text };
  if (saving === 'Offline')
    return {
      kind: 'status',
      text: "Not saved yet: memo can't reach its server. Your practice is kept on this computer and will save automatically when the server is back.",
    };
  if (saving !== 'Saved')
    return { kind: 'status', text: 'Saving your session…' };
  if (failed)
    return { kind: 'status', text: 'Summary unavailable. Your session is saved.' };
  return null;
}

/** One sentence about where saved records stand, for any result screen. */
export function savedNote(saving: SavingState, what: string) {
  return saving === 'Offline'
    ? `Your ${what} are not saved yet: memo can't reach its server. They are kept on this computer and will save automatically when the server is back.`
    : saving === 'Saving…'
      ? `Saving your ${what}…`
      : `Your ${what} are saved with your history.`;
}
