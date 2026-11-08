import type { Runtime as SharedRuntime } from '../contracts/runtime';
import type { TherapyApi } from '../contracts/therapist';

/** A1-owned refinement until the coordinator makes SharedRuntime.therapy required. */
export type TherapyRuntime = Omit<SharedRuntime, 'therapy'> & {
  readonly therapy: TherapyApi;
};
