import { describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { RedisLinkCache } from "../../src/infrastructure/redis/redis-link.cache";
import { RedisRateLimiter } from "../../src/infrastructure/redis/redis-rate-limiter";
import { CircuitBreaker } from "../../src/infrastructure/resilience/circuit-breaker";
import { silentLogger } from "../unit/fakes";
import { dropDatabase, infrastructureAvailable, startApp, testConfig } from "./support";

const available = await infrastructureAvailable();

describe("Redis outage (unreachable server)", () => {
  const deadRedis = () =>
    new Redis("redis://127.0.0.1:1", { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
  const breaker = () => new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });

  test("cache degrades to misses instead of throwing", async () => {
    const redis = deadRedis();
    const cache = new RedisLinkCache(redis, breaker(), silentLogger, 60);
    expect(await cache.get("abc")).toEqual({ status: "miss" });
    await cache.set("abc", { longUrl: "https://example.com", expiresAt: null }, 60);
    await cache.delete("abc");
    redis.disconnect();
  });

  test("rate limiter fails open", async () => {
    const redis = deadRedis();
    const limiter = new RedisRateLimiter(redis, breaker(), silentLogger, { limit: 1, windowSeconds: 60 });
    expect((await limiter.consume("k")).allowed).toBe(true);
    redis.disconnect();
  });
});

describe.skipIf(!available)("rate limiting against real Redis", () => {
  test("blocks the request over the limit with 429 and Retry-After", async () => {
    const config = testConfig({ RATE_LIMIT_MAX: "3", RATE_LIMIT_WINDOW_SECONDS: "60" });
    const container = await startApp(config);
    const key = crypto.randomUUID();
    try {
      const create = () =>
        container.app.request(
          "/api/v1/links",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: `https://example.com/${crypto.randomUUID()}` }),
          },
          { ip: key },
        );
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await create()).status);
      expect(statuses).toEqual([201, 201, 201, 429, 429]);
      expect((await create()).headers.get("retry-after")).toBeTruthy();
    } finally {
      await container.shutdown();
      await dropDatabase(config);
    }
  });
});
