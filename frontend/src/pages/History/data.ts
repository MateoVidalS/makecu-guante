import { useQuery } from '@tanstack/react-query';
import { getSessions } from '../../api/client';

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
