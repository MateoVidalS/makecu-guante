import { useQuery } from '@tanstack/react-query';
import { getSessions } from '../../api/client';
import type { RomPoint, Session } from '../../contracts/api';
import { formatDate, rangeSessions } from '../../components/charts';

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

/**
 * Dates, demo flags and a note for the hand map captions. They describe the same sessions
 * as handFromOverview: the first and latest finished sessions with a range to show.
 */
export function firstAndLast(
  sessions: Session[] | undefined,
  openingPoints?: RomPoint[],
) {
  const { measured, direction, note } = rangeSessions(sessions, openingPoints);
  const first = measured[0],
    last = measured.at(-1);
  return {
    assistDirection: direction,
    firstDemo: first?.is_demo,
    lastDemo: last?.is_demo,
    firstDate: first && formatDate(first.started_at),
    lastDate: last && formatDate(last.started_at),
    note,
  };
}
