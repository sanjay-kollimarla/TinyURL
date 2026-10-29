import type { Redis } from "ioredis";
import type { Logger, RateLimitDecision, RateLimiter } from "../../application/ports";
import { type CircuitBreaker, CircuitOpenError } from "../resilience/circuit-breaker";

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Fixed-window counter. Fails open: an outage must not block link creation. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly breaker: CircuitBreaker,
    private readonly logger: Logger,
    private readonly options: RateLimitOptions,
  ) {}

  async consume(key: string): Promise<RateLimitDecision> {
    const { limit, windowSeconds } = this.options;
    const redisKey = `rl:${key}`;
    try {
      return await this.breaker.exec(async () => {
        const [[, count], [, ttl]] = (await this.redis.multi().incr(redisKey).ttl(redisKey).exec()) as [
          [unknown, number],
          [unknown, number],
        ];

        // TTL is -1 when the key has no expiry yet (first hit, or a lost EXPIRE).
        if (ttl < 0) await this.redis.expire(redisKey, windowSeconds);

        return {
          allowed: count <= limit,
          remaining: Math.max(0, limit - count),
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
        };
      });
    } catch (err) {
      if (!(err instanceof CircuitOpenError)) this.logger.warn({ err }, "rate limiter unavailable, allowing request");
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }
}
