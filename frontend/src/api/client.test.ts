import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  SERVER_UNREACHABLE_MESSAGE,
  exportData,
  request,
} from './client';

afterEach(() => vi.unstubAllGlobals());

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiRequestError;
  }
  throw new Error('expected a failure');
}

describe('API client errors', () => {
  it('turns a stopped server into a plain sentence, not a fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const error = await failure(request('/health'));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(0);
    expect(error.message).toBe(SERVER_UNREACHABLE_MESSAGE);
  });
  it('turns an empty proxy 500 into the same sentence, not a JSON parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response('', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );
    const error = await failure(request('/calibration'));
    expect(error.status).toBe(500);
    expect(error.detail.code).toBe('unreachable');
    expect(error.message).toBe(SERVER_UNREACHABLE_MESSAGE);
    const exported = await failure(exportData('csv'));
    expect(exported.message).toBe(SERVER_UNREACHABLE_MESSAGE);
  });
  it('keeps the API error message and status when the API answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'not_found', message: 'Session 9 not found' } },
            { status: 404 },
          ),
        ),
    );
    const error = await failure(request('/sessions/9'));
    expect(error.status).toBe(404);
    expect(error.detail).toEqual({
      code: 'not_found',
      message: 'Session 9 not found',
    });
  });
});
