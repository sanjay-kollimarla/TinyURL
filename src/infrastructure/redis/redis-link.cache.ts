import type { Redis } from "ioredis";
import type { CacheLookup, LinkCache, Logger } from "../../application/ports";
import type { RedirectTarget } from "../../domain/link";
import { type CircuitBreaker, CircuitOpenError } from "../resilience/circuit-breaker";

const KEY_PREFIX = "link:";
const NEGATIVE_MARKER = "-";

/**
 * Cache-aside store for redirect targets. Redis is an optimisation, not a
 * dependency: every failure (including an open circuit) degrades to a cache
 * miss so redirects keep working from the database.
 */
export class RedisLinkCache implements LinkCache {
  constructor(
    private readonly redis: Redis,
    private readonly breaker: CircuitBreaker,
    private readonly logger: Logger,
    private readonly negativeTtlSeconds: number,
  ) {}

  async get(code: string): Promise<CacheLookup> {
    try {
      const raw = await this.breaker.exec(() => this.redis.get(KEY_PREFIX + code));
      if (raw === null) return { status: "miss" };
      if (raw === NEGATIVE_MARKER) return { status: "negative" };
      return { status: "hit", target: JSON.parse(raw) as RedirectTarget };
    } catch (err) {
      this.report(err, "cache read failed");
      return { status: "miss" };
    }
  }

  set(code: string, target: RedirectTarget, ttlSeconds: number): Promise<void> {
    return this.write(() => this.redis.set(KEY_PREFIX + code, JSON.stringify(target), "EX", ttlSeconds));
  }

  markMissing(code: string): Promise<void> {
    return this.write(() => this.redis.set(KEY_PREFIX + code, NEGATIVE_MARKER, "EX", this.negativeTtlSeconds));
  }

  delete(code: string): Promise<void> {
    return this.write(() => this.redis.del(KEY_PREFIX + code));
  }

  private async write(command: () => Promise<unknown>): Promise<void> {
    try {
      await this.breaker.exec(command);
    } catch (err) {
      this.report(err, "cache write failed");
    }
  }

  /** An open circuit is already known and surfaced via metrics; don't log it per request. */
  private report(err: unknown, message: string): void {
    if (!(err instanceof CircuitOpenError)) this.logger.warn({ err }, message);
  }
}
