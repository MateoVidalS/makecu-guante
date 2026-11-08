import { useQuery } from '@tanstack/react-query';
import { getSessions } from '../../api/client';
import type { Session } from '../../contracts/api';
import { latestCohort, directionOf } from '../../components/charts/direction';
import { formatDate } from '../../components/charts';

// The list endpoint defaults to 50: fetch all pages for complete trends and exports.
export function useAllSessions() {
  return useQuery({
    queryKey: ['sessions', 'all'],
    queryFn: async () => {
      const sessions = [];
      const limit = 100;
      for (let offset = 0; ; offset += limit) {
        const page = await getSessions({ limit, offset });
        sessions.push(...page);
        if (page.length < limit) break;
      }
      return sessions;
    },
  });
}

/** Dates and demo flags of the first and latest sessions, for the hand map captions. */
export function firstAndLast(sessions: Session[] | undefined) {
  const ordered = latestCohort((sessions ?? []).filter((s) => s.summary)).sort(
    (a, b) =>
      Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id,
  );
  const first = ordered[0],
    last = ordered.at(-1);
  return {
    assistDirection: directionOf(last),
    firstDemo: first?.is_demo,
    lastDemo: last?.is_demo,
    firstDate: first && formatDate(first.started_at),
    lastDate: last && formatDate(last.started_at),
  };
}
