import type { ClickEvent, ClickRecorder, ClickStore, Logger } from "./ports";

export interface BufferedClickRecorderOptions {
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  /** Hard cap: beyond this, events are shed to protect redirect latency and memory. */
  readonly maxBuffered: number;
  readonly onDrop?: (() => void) | undefined;
}

/**
 * Write-behind buffer that turns per-redirect analytics into batched writes.
 * `record` is synchronous and O(1) so it can never slow a redirect down.
 */
export class BufferedClickRecorder implements ClickRecorder {
  private buffer: ClickEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private dropped = 0;

  constructor(
    private readonly store: ClickStore,
    private readonly logger: Logger,
    private readonly options: BufferedClickRecorderOptions,
  ) {}

  get pending(): number {
    return this.buffer.length;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    this.timer.unref();
  }

  record(event: ClickEvent): void {
    if (this.buffer.length >= this.options.maxBuffered) {
      this.options.onDrop?.();
      if (++this.dropped % 1000 === 1) {
        this.logger.warn({ dropped: this.dropped }, "click buffer full, shedding events");
      }
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.options.batchSize) void this.flush();
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.buffer.length === 0) return Promise.resolve();

    this.inFlight = this.writeNextBatch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Stops the timer and drains whatever is left; call during graceful shutdown. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const maxRounds = Math.ceil(this.buffer.length / this.options.batchSize) + 2;
    for (let round = 0; round < maxRounds && this.buffer.length > 0; round++) {
      await this.flush();
    }
    if (this.buffer.length > 0) {
      this.logger.error({ lost: this.buffer.length }, "click events lost at shutdown");
    }
  }

  private async writeNextBatch(): Promise<void> {
    const batch = this.buffer.splice(0, this.options.batchSize);
    try {
      await this.store.recordBatch(batch);
    } catch (err) {
      const room = Math.max(0, this.options.maxBuffered - this.buffer.length);
      this.buffer.unshift(...batch.slice(0, room));
      this.logger.error({ err, requeued: Math.min(room, batch.length) }, "click batch write failed");
    }
  }
}
