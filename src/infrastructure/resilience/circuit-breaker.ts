export class CircuitOpenError extends Error {
  constructor() {
    super("circuit open");
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. */
  readonly failureThreshold: number;
  /** How long to fail fast before allowing a single trial call. */
  readonly resetTimeoutMs: number;
  readonly now?: () => number;
}

/**
 * Fails fast while a dependency is unhealthy, so a Redis outage costs
 * microseconds per request instead of a command timeout on every redirect.
 * closed -> (N failures) -> open -> (timeout) -> half-open -> trial call decides.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.options.resetTimeoutMs ? "half-open" : "open";
  }

  async exec<T>(task: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open" || (state === "half-open" && this.trialInFlight)) throw new CircuitOpenError();

    const isTrial = state === "half-open";
    if (isTrial) this.trialInFlight = true;
    try {
      const result = await task();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      this.failures++;
      if (isTrial || this.failures >= this.options.failureThreshold) this.openedAt = this.now();
      throw err;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }
}
