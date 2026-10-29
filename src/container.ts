import { Redis } from "ioredis";
import { BufferedClickRecorder } from "./application/buffered-click-recorder";
import { LinkService } from "./application/link.service";
import type { Clock } from "./application/ports";
import { RedirectService } from "./application/redirect.service";
import type { Config } from "./config/env";
import { Base62CodeGenerator } from "./infrastructure/id/base62-code-generator";
import { BlockSequence } from "./infrastructure/id/block-sequence";
import { createLogger } from "./infrastructure/logging/logger";
import { InstrumentedLinkCache, Metrics } from "./infrastructure/metrics/metrics";
import { applyClickRetention, runMigrations } from "./infrastructure/mongo/migrations";
import { collectionsOf, connectMongo } from "./infrastructure/mongo/mongo";
import { MongoBlockAllocator } from "./infrastructure/mongo/mongo-block-allocator";
import { MongoClickStore } from "./infrastructure/mongo/mongo-click.store";
import { MongoLinkRepository } from "./infrastructure/mongo/mongo-link.repository";
import { RedisLinkCache } from "./infrastructure/redis/redis-link.cache";
import { RedisRateLimiter } from "./infrastructure/redis/redis-rate-limiter";
import { CircuitBreaker } from "./infrastructure/resilience/circuit-breaker";
import { initTracing } from "./infrastructure/tracing/tracing";
import { createApp } from "./interfaces/http/app";

const systemClock: Clock = { now: () => new Date() };

/** Composition root: the only place that knows which concrete implementations are wired together. */
export async function buildContainer(config: Config) {
  const logger = createLogger(config);
  let draining = false;
  const tracer = initTracing(config);

  const mongo = connectMongo(config);
  await mongo.connect();
  const collections = collectionsOf(mongo.db(config.MONGO_DB));
  await runMigrations(mongo.db(config.MONGO_DB));
  await applyClickRetention(mongo.db(config.MONGO_DB), config.CLICK_RETENTION_DAYS);

  const redis = new Redis(config.REDIS_URL, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 200,
  });
  redis.on("error", (err) => logger.warn({ err }, "redis connection error"));

  const linkRepository = new MongoLinkRepository(collections.links);
  const clickStore = new MongoClickStore(collections);
  const metrics = new Metrics();
  const redisBreaker = new CircuitBreaker({
    failureThreshold: config.CIRCUIT_FAILURE_THRESHOLD,
    resetTimeoutMs: config.CIRCUIT_RESET_MS,
  });
  metrics.gauge("tinyurl_redis_circuit_open", "1 when the Redis circuit breaker is not closed", () =>
    redisBreaker.state === "closed" ? 0 : 1,
  );

  const cache = new InstrumentedLinkCache(
    new RedisLinkCache(redis, redisBreaker, logger, config.NEGATIVE_CACHE_TTL_SECONDS),
    metrics,
  );
  const rateLimiter = new RedisRateLimiter(redis, redisBreaker, logger, {
    limit: config.RATE_LIMIT_MAX,
    windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
  });

  const codeGenerator = new Base62CodeGenerator(
    new BlockSequence(new MongoBlockAllocator(collections.counters), config.ID_BLOCK_SIZE),
    config.CODE_LENGTH,
  );

  const clickRecorder = new BufferedClickRecorder(clickStore, logger, {
    batchSize: config.ANALYTICS_BATCH_SIZE,
    flushIntervalMs: config.ANALYTICS_FLUSH_INTERVAL_MS,
    maxBuffered: config.ANALYTICS_MAX_BUFFER,
    onDrop: () => metrics.recordClickDropped(),
  });
  metrics.gauge("tinyurl_click_buffer_pending", "Click events awaiting persistence", () => clickRecorder.pending);
  clickRecorder.start();

  const linkService = new LinkService(
    linkRepository,
    cache,
    clickStore,
    codeGenerator,
    systemClock,
    new URL(config.BASE_URL).host,
  );
  const redirectService = new RedirectService(linkRepository, cache, clickRecorder, systemClock, {
    cacheTtlSeconds: config.CACHE_TTL_SECONDS,
  });

  const app = createApp({
    linkService,
    redirectService,
    rateLimiter,
    logger,
    baseUrl: config.BASE_URL,
    apiKey: config.API_KEY,
    trustProxy: config.TRUST_PROXY,
    tracingEnabled: tracer !== null,
    metrics,
    checkReadiness: async () => {
      if (draining) throw new Error("shutting down");
      await Promise.all([mongo.db(config.MONGO_DB).command({ ping: 1 }), redis.ping()]);
    },
  });

  return {
    app,
    logger,
    /** Fails /readyz so the load balancer stops routing here before the server closes. */
    drain(): void {
      draining = true;
    },
    /** Flushes pending analytics, then releases connections. */
    async shutdown(): Promise<void> {
      await clickRecorder.stop();
      redis.disconnect();
      await mongo.close();
      await tracer?.shutdown();
    },
  };
}
