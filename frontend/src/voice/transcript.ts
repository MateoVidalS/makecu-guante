import type { TranscriptLine } from '../contracts/api';

/** Retain failed batches and serialize writes, including stop/start overlap. */
export class TranscriptBatcher {
  private lines: TranscriptLine[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private inflight: Promise<void> | null = null;
  private stopped = false;
  private disposed = false;
  constructor(
    private save: (lines: TranscriptLine[]) => Promise<void>,
    private failed: () => void = () => {},
  ) {}
  start() {
    this.stopped = false;
    this.schedule();
  }
  private schedule() {
    if (this.disposed) return;
    this.timer ??= setInterval(() => {
      void this.flush();
    }, 10000);
  }
  add(role: TranscriptLine['role'], text: string) {
    if (text.trim())
      this.lines.push({ t: new Date().toISOString(), role, text: text.trim() });
  }
  async flush(): Promise<void> {
    if (this.inflight) {
      await this.inflight;
      return;
    }
    if (!this.lines.length) return;
    const batch = this.lines.splice(0);
    this.inflight = this.save(batch).catch(() => {
      this.lines.unshift(...batch);
      this.failed();
      this.schedule();
    });
    await this.inflight;
    this.inflight = null;
    if (this.stopped && !this.lines.length) this.dispose();
  }
  async stop() {
    this.stopped = true;
    await this.flush();
    if (!this.lines.length) this.dispose();
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
