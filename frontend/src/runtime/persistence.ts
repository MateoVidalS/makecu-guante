import { createStore } from 'zustand/vanilla';
import * as api from '../api/client';
import type { SessionIn, EvaluationIn } from '../contracts/api';
import type { AttemptResult, SessionSummary } from '../contracts/engine';

export type RuntimeApi = Pick<
  typeof api,
  'createSession' | 'addAttempt' | 'endSession' | 'createEvaluation'
>;
type Job =
  | { kind: 'session'; key: string; value: SessionIn }
  | { kind: 'attempt'; key: string; value: AttemptResult }
  | { kind: 'end'; key: string; value: SessionSummary }
  | { kind: 'evaluation'; value: EvaluationIn };
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const storageKey = 'rehab.runtime.pending.v1';

/** Ordered, durable writes. A failed create holds its attempts and end behind it. */
export class PersistenceQueue {
  readonly store = createStore<{
    status: 'Saving…' | 'Saved' | 'Offline';
    pending: number;
    durable: boolean;
  }>(() => ({ status: 'Saved', pending: 0, durable: true }));
  private jobs: Job[] = [];
  private ids: Record<string, number> = {};
  private running: Promise<void> | null = null;
  constructor(
    private readonly api: RuntimeApi,
    private readonly storage?: QueueStorage,
    private readonly onSession?: (key: string, id: number) => void,
    private readonly onSaved?: () => void,
  ) {
    try {
      const saved = storage?.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          jobs: Job[];
          ids: Record<string, number>;
        };
        this.jobs = parsed.jobs;
        this.ids = parsed.ids;
      }
    } catch {
      this.store.setState({ durable: false });
    }
    this.store.setState({
      pending: this.jobs.length,
      status: this.jobs.length ? 'Offline' : 'Saved',
    });
  }
  enqueue(job: Job) {
    this.jobs.push(structuredClone(job));
    this.persist();
    void this.flush();
  }
  private persist() {
    try {
      this.storage?.setItem(
        storageKey,
        JSON.stringify({ jobs: this.jobs, ids: this.ids }),
      );
    } catch {
      this.store.setState({ durable: false });
    }
    this.store.setState({ pending: this.jobs.length });
  }
  async flush(): Promise<void> {
    if (!this.running) {
      this.running = Promise.resolve()
        .then(() => this.drain())
        .finally(() => {
          this.running = null;
        });
    }
    await this.running;
    // A producer can enqueue while a completed drain is awaiting its final microtask.
    if (this.jobs.length && this.store.getState().status !== 'Offline')
      await this.flush();
  }
  private async drain() {
    if (!this.jobs.length) return;
    this.store.setState({ status: 'Saving…' });
    try {
      while (this.jobs.length) {
        const job = this.jobs[0];
        if (job.kind === 'session') {
          const session = await this.api.createSession(job.value);
          this.ids[job.key] = session.id;
          this.onSession?.(job.key, session.id);
        } else if (job.kind === 'evaluation')
          await this.api.createEvaluation(job.value);
        else {
          const id = this.ids[job.key];
          if (!id) throw new Error('Session must be saved before its results');
          if (job.kind === 'attempt')
            await this.api.addAttempt({ id, result: job.value });
          else {
            await this.api.endSession({ id, summary: job.value });
            delete this.ids[job.key];
          }
        }
        this.jobs.shift();
        this.persist();
        this.onSaved?.();
      }
      this.store.setState({ status: 'Saved' });
    } catch {
      this.store.setState({ status: 'Offline' });
    }
  }
}
