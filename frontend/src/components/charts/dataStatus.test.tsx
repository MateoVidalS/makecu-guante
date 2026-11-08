import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { ApiRequestError, SERVER_UNREACHABLE_MESSAGE } from '../../api/client';
import { DataStatus } from './index';

afterEach(cleanup);

function Records({ fail }: { fail: () => boolean }) {
  const query = useQuery({
    queryKey: ['records'],
    queryFn: async () => {
      if (fail())
        throw new ApiRequestError(0, {
          code: 'unreachable',
          message: SERVER_UNREACHABLE_MESSAGE,
        });
      return 'Three sessions';
    },
  });
  return (
    <DataStatus loading={query.isPending} error={query.error}>
      <p>{query.data}</p>
    </DataStatus>
  );
}

describe('DataStatus', () => {
  it('says why records failed and retries them, instead of a dead end', async () => {
    let down = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Records fail={() => down} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      SERVER_UNREACHABLE_MESSAGE,
    );
    down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Three sessions')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not offer a pointless retry for a record that does not exist', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataStatus
          error={
            new ApiRequestError(404, { code: 'not_found', message: 'Nope' })
          }
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This record was not found.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
