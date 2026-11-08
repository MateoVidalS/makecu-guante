import { describe, expect, it } from 'vitest';
import { recapStatus } from './recapStatus';

const base = { fetching: false, failed: false } as const;

describe('recap status line', () => {
  it('explains an unreachable server instead of waiting "after saving" forever', () => {
    expect(recapStatus({ ...base, saving: 'Offline' })).toEqual({
      kind: 'status',
      text: expect.stringMatching(/Not saved yet.*saves by itself/),
    });
  });
  it('says it is saving while the queue drains', () => {
    expect(recapStatus({ ...base, saving: 'Saving…' })?.text).toBe(
      'Saving your session…',
    );
  });
  it('shows the coach words once saved, or a clear fallback', () => {
    expect(
      recapStatus({ ...base, saving: 'Saved', text: 'Nice steady work.' }),
    ).toEqual({ kind: 'coach', text: 'Nice steady work.' });
    expect(recapStatus({ ...base, saving: 'Saved', failed: true })?.text).toBe(
      'Summary unavailable. Your session is saved.',
    );
    expect(
      recapStatus({ ...base, saving: 'Saved', fetching: true })?.text,
    ).toBe('Preparing your recap…');
  });
});
