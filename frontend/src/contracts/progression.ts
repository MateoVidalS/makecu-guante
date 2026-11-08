// Adaptive progression ("today's plan") contract: docs/plan/17-progression.md, docs/plan/03-contracts.md §4.
// The plan is computed in the browser from recent sessions (src/progression/plan.ts); the backend
// only stores the therapist's switch.
export type ProgressionChallenge = 'gentle' | 'standard';
export interface ProgressionSettings {
  enabled: boolean; // false by default: practice runs the standard plan
  challenge: ProgressionChallenge;
  updated_at: string | null; // null until first saved
}
export type ProgressionSettingsIn = Omit<ProgressionSettings, 'updated_at'>;
export const DEFAULT_PROGRESSION_SETTINGS: ProgressionSettings = {
  enabled: false,
  challenge: 'standard',
  updated_at: null,
};
