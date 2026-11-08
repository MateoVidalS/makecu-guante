import { expect, it } from 'vitest';
import { DEFAULT_EXERCISE_SETTINGS, DEFAULT_PLAN } from '../contracts/poses';
import type { SessionIn } from '../contracts/api';
import { powerAwareSettings } from './power';
import { PersistenceQueue, sessionForStorage } from './persistence';

const lowPower = powerAwareSettings(DEFAULT_EXERCISE_SETTINGS, true, true);
const session: SessionIn = {
  mode: 'exercise',
  plan: DEFAULT_PLAN,
  settings: lowPower,
  calibration_id: 1,
  is_demo: true,
};

it('stores only the contract settings, keeping the effective assist time', () => {
  const stored = sessionForStorage(session);
  expect(Object.keys(stored.settings).sort()).toEqual(
    Object.keys(DEFAULT_EXERCISE_SETTINGS).sort(),
  );
  expect(stored.settings.assist_max_s).toBe(lowPower.assist_max_s);
  expect('assist_max_parallel' in stored.settings).toBe(false);
});

it('saves a low-power session and its end instead of retrying forever', async () => {
  const sent: SessionIn[] = [];
  const ended: number[] = [];
  const queue = new PersistenceQueue({
    createSession: async (value: SessionIn) => {
      // The backend schema forbids extra keys (ConfigDict extra="forbid").
      if ('assist_max_parallel' in value.settings) throw new Error('422');
      sent.push(value);
      return { id: 7 } as never;
    },
    addAttempt: async () => ({}) as never,
    endSession: async (end: unknown) => {
      ended.push((end as { id: number }).id);
      return {} as never;
    },
    createEvaluation: async () => ({}) as never,
  });
  queue.enqueue({ kind: 'session', key: 's', value: session });
  queue.enqueue({ kind: 'end', key: 's', value: {} as never });
  await new Promise((r) => setTimeout(r, 50));
  expect(sent).toHaveLength(1);
  expect(ended).toEqual([7]);
  expect(queue.store.getState().status).toBe('Saved');
});
