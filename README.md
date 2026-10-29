# TinyURL

Distributed URL shortening service: unique short links, async click analytics, duplicate detection and automatic expiry. Bun · TypeScript · MongoDB · Redis · Docker.

## Quick start

```bash
docker compose up -d --build        # app on http://localhost:8080 (override with HOST_PORT)
bun install && bun run test        # unit + HTTP tests, no infrastructure needed
bun run test:integration           # real MongoDB + Redis (see below)
bun run dev                         # local dev (needs Mongo + Redis, see .env.example)
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/links` | Create. Body: `{ url, alias?, ttlSeconds? \| expiresAt? }`. `201` new, `200` duplicate URL returned |
| `GET` | `/api/v1/links/:code/stats?days=30` | Total clicks, last click, daily breakdown |
| `DELETE` | `/api/v1/links/:code` | Delete |
| `GET` | `/:code` | `302` redirect (`404` unknown, `410` expired) |
| `GET` | `/healthz`, `/readyz` | Liveness / readiness (Mongo + Redis ping) |

Set `API_KEY` to require the `x-api-key` header on `/api/v1/*`. Creation is rate-limited per client via Redis.

## Architecture

```
interfaces/http   Hono routes, validation, error mapping        (delivery)
application       LinkService, RedirectService, ports            (use cases)
domain            Link, URL/alias rules, expiry policy, errors   (pure, no I/O)
infrastructure    Mongo, Redis, id generation                    (adapters)
container.ts      composition root: the only place that knows concrete classes
```

Dependencies point inward; the application layer depends only on the interfaces in `application/ports.ts` (Dependency Inversion), so every adapter is swappable and unit-tested with in-memory fakes.

**Redirect path (hot):** Redis cache-aside → on miss, one Mongo read per key via `SingleFlight` (stampede protection) → cache with TTL capped at the link's remaining lifetime. Unknown codes are negative-cached. Redis failures degrade to a miss, never to an error. Click events are pushed to an in-memory buffer without awaiting.

**Short codes:** each instance reserves a block of ids from a Mongo counter (one write per `ID_BLOCK_SIZE` links), then a bijective scramble + base62 encoding yields fixed-length codes that are collision-free by construction but not enumerable.

**Analytics:** `BufferedClickRecorder` (write-behind) flushes batches by size or interval via `insertMany` + one `bulkWrite` of counters. Bounded buffer sheds load rather than hurting redirects; shutdown drains it. Events carry ids so retried inserts are idempotent; counter increments are at-least-once on retry.

**Duplicate detection:** URLs are normalised and SHA-256 hashed; a unique partial index (`dedupKey`) makes "one permanent link per URL" race-safe. Aliased and expiring links are never deduplicated.

**Expiration:** Mongo TTL index removes expired links; the read path also enforces `expiresAt` so the ≤60 s TTL-sweep gap is never observable. Click events are purged after `CLICK_RETENTION_DAYS`.

| Pattern | Where |
| --- | --- |
| Repository | `LinkRepository` / `MongoLinkRepository` |
| Cache-aside + Null-object (negative cache) | `RedisLinkCache`, `RedirectService` |
| Strategy / Ports & Adapters | `CodeGenerator`, `RateLimiter`, `ClickStore`, … |
| Write-behind buffer | `BufferedClickRecorder` |
| Single-flight (request coalescing) | `SingleFlight` |
| Dependency Injection / Composition Root | `container.ts` |

## Operations

- **Metrics:** `GET /metrics` (Prometheus; protected by `API_KEY` when set): request latency histogram, cache hit/miss/negative counts, click buffer depth and drops, Redis circuit state, plus Node/process defaults.
- **Resilience:** a circuit breaker shields redirects from a Redis outage (after `CIRCUIT_FAILURE_THRESHOLD` failures, calls fail fast for `CIRCUIT_RESET_MS`, then one trial call probes recovery). Verified: with Redis stopped, redirects stay `302` at ~5 ms.
- **Logging:** pino; pretty in `NODE_ENV=development`, JSON otherwise. API requests carry `X-Request-Id`.
- **Graceful shutdown:** `/readyz` flips to 503, waits `SHUTDOWN_GRACE_MS`, drains in-flight requests, flushes analytics; hard deadline `SHUTDOWN_TIMEOUT_MS`.
- **Hardening:** secure headers and a 16 KB body cap on the API, Mongo `$jsonSchema` validators, Mongo timeouts. Set `TRUST_PROXY=true` only behind a load balancer: the rate limiter then keys on the last `x-forwarded-for` hop.
- **Migrations:** versioned, idempotent, recorded in a `migrations` collection and applied at startup (`infrastructure/mongo/migrations.ts`); safe under concurrent rolling deploys. Click-retention TTL is reconciled from config on each start.
- **Tracing:** OpenTelemetry (OTLP/HTTP) is enabled by setting `OTEL_EXPORTER_OTLP_ENDPOINT`; one server span per request, continues incoming W3C `traceparent`, head-sampled at `OTEL_SAMPLE_RATIO` (default 5%). Off by default, zero cost when off.
- **Quality gates:** `bun run lint` (Biome), `bun run typecheck`, `bun test`; all run in `.github/workflows/ci.yml` together with the integration suite against Mongo/Redis service containers.
- **Integration tests:** `docker compose -f docker-compose.yml -f docker-compose.ports.yml up -d mongo redis` (override host ports with `MONGO_HOST_PORT` / `REDIS_HOST_PORT`, then set `MONGO_URI` / `REDIS_URL`), then `bun run test:integration`. They cover concurrent duplicate creation, multi-instance code uniqueness, alias races, expiry, migrations, validators, rate limiting, drain-on-shutdown, metrics and OTLP export. Without services they skip locally; CI sets `REQUIRE_INTEGRATION=1` so they must run.
- **AWS:** `deploy/ecs-task-definition.json` is a Fargate task definition template (secrets from Secrets Manager, health check, 30 s stop timeout, `TRUST_PROXY=true`). Fill in the `<PLACEHOLDERS>`.

## Performance

Measured locally (single app container on Docker Desktop, load generator on the same machine, 100 concurrent connections, 20k redirects): **~8,000 req/s, p50 8.5 ms, p95 30 ms**, with all 20,004 clicks recorded. For a proper run use k6: `bun run loadtest` (targets 1,500 rps, p95 < 50 ms).

## Scaling & AWS

The app is stateless: run N replicas behind an ALB (ECS Fargate or EKS), MongoDB Atlas/DocumentDB with a replica set, ElastiCache Redis. Scale redirects horizontally; Mongo only sees cache misses and batched analytics writes. Health checks: `/healthz` (liveness), `/readyz` (target-group readiness).

## Known trade-offs

- Expired links are deleted (with their counters) by the TTL index; click events remain until retention ends.
- A delete racing a concurrent cache load can leave a stale cache entry for up to `CACHE_TTL_SECONDS`.
