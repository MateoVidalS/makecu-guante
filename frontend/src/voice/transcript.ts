import type { TranscriptLine } from '../contracts/api';

/** Retain failed batches and serialize writes, including stop/start overlap. */
export class TranscriptBatcher {
  private lines: TranscriptLine[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private inflight: Promise<void> | null = null;
  constructor(
    private save: (lines: TranscriptLine[]) => Promise<void>,
    private failed: () => void = () => {},
  ) {}
  start() {
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
      if (this.lines.length) return this.flush();
      return;
    }
    if (!this.lines.length) return;
    const batch = this.lines.splice(0);
    const operation = this.save(batch).catch(() => {
      this.lines.unshift(...batch);
      this.failed();
    });
    this.inflight = operation;
    await operation;
    this.inflight = null;
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }
}
