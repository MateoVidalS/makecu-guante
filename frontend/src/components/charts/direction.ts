import type { AssistDirection } from '../../contracts/calibration';

export const LEGACY_GLOVE = 'Earlier closing-assist glove';
export const directionOf = (record?: {
  assist_direction?: AssistDirection;
}): AssistDirection => (record?.assist_direction === 'open' ? 'open' : 'close');
export const directionLabel = (record?: {
  assist_direction?: AssistDirection;
}) => (directionOf(record) === 'open' ? 'Opening-assist glove' : LEGACY_GLOVE);

/** Comparisons use the latest record's mechanics, never a different glove direction. */
export function latestCohort<
  T extends { started_at: string; assist_direction?: AssistDirection },
>(records: T[]): T[] {
  const ordered = [...records].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  const latest = ordered.at(-1);
  return ordered.filter(
    (record) => directionOf(record) === directionOf(latest),
  );
}
