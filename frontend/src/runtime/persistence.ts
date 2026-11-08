import { createStore } from 'zustand/vanilla';
import * as api from '../api/client';
import type { SessionIn, EvaluationIn } from '../contracts/api';
import type { CoachDecision, FeelingEntry } from '../contracts/therapist';
import type { AttemptResult, SessionSummary } from '../contracts/engine';

export type RuntimeApi = Pick<
  typeof api,
  'createSession' | 'addAttempt' | 'endSession' | 'createEvaluation'
> & {
  addCoachDecisions?: (id: number, decisions: CoachDecision[]) => Promise<void>;
  addFeelings?: (id: number, feelings: FeelingEntry[]) => Promise<void>;
};
type Job =
  | { kind: 'session'; key: string; value: SessionIn }
  | { kind: 'attempt'; key: string; value: AttemptResult }
  | { kind: 'end'; key: string; value: SessionSummary }
  | { kind: 'evaluation'; value: EvaluationIn }
  | { kind: 'decision'; key: string; value: CoachDecision }
  | { kind: 'feeling'; key: string; value: FeelingEntry };
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
          const session = await this.api.createSession(
            sessionForStorage(job.value),
          );
          this.ids[job.key] = session.id;
          this.onSession?.(job.key, session.id);
        } else if (job.kind === 'evaluation')
          await this.api.createEvaluation(job.value);
        else {
          const id = this.ids[job.key];
          if (!id) throw new Error('Session must be saved before its results');
          if (job.kind === 'attempt')
            await this.api.addAttempt({ id, result: job.value });
          else if (job.kind === 'decision') {
            const decisions = [{ ...job.value, session_id: id }];
            if (this.api.addCoachDecisions)
              await this.api.addCoachDecisions(id, decisions);
            else
              await api.request<void>(`/sessions/${id}/coach_decisions`, {
                method: 'POST',
                body: JSON.stringify({ decisions }),
              });
          } else if (job.kind === 'feeling') {
            const feelings = [{ ...job.value, session_id: id }];
            if (this.api.addFeelings) await this.api.addFeelings(id, feelings);
            else
              await api.request<void>(`/sessions/${id}/feelings`, {
                method: 'POST',
                body: JSON.stringify({ feelings }),
              });
          } else {
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

/** The REST contract stores exactly these settings and rejects any other key. */
const STORED_SETTINGS = [
  'present_s',
  'attempt_s',
  'hold_s',
  'assist_max_s',
  'rest_s',
  'tolerance',
  'reach_dwell_s',
  'assist_speed',
  'plateau_s',
  'assist_enabled',
] as const;

/**
 * Engine-only settings (e.g. assist_max_parallel from the low-power mode) never reach the
 * backend, whose schema forbids extra keys: one would fail every retry and hold the
 * session, its attempts and the recap behind it. Applied when sending, so sessions
 * already queued with an extra key are saved too.
 */
export function sessionForStorage(value: SessionIn): SessionIn {
  if (!value.settings) return value;
  const settings = Object.fromEntries(
    STORED_SETTINGS.filter((key) => key in value.settings!).map((key) => [
      key,
      value.settings![key],
    ]),
  ) as unknown as SessionIn['settings'];
  return { ...value, settings };
}
