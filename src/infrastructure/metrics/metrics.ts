import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import type { CacheLookup, LinkCache } from "../../application/ports";
import type { RedirectTarget } from "../../domain/link";

const LATENCY_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

export class Metrics {
  readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: "tinyurl_http_request_duration_seconds",
    help: "HTTP request latency",
    labelNames: ["method", "route", "status"] as const,
    buckets: LATENCY_BUCKETS,
    registers: [this.registry],
  });

  private readonly cacheLookups = new Counter({
    name: "tinyurl_cache_lookups_total",
    help: "Redirect cache lookups by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  private readonly clicksDropped = new Counter({
    name: "tinyurl_clicks_dropped_total",
    help: "Click events shed because the buffer was full",
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.httpDuration.observe({ method, route, status: String(status) }, seconds);
  }

  recordCacheLookup(outcome: CacheLookup["status"]): void {
    this.cacheLookups.inc({ outcome });
  }

  recordClickDropped(): void {
    this.clicksDropped.inc();
  }

  /** Registers a gauge that is sampled at scrape time. */
  gauge(name: string, help: string, sample: () => number): void {
    new Gauge({
      name,
      help,
      registers: [this.registry],
      collect() {
        this.set(sample());
      },
    });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}

/** Decorator that counts cache outcomes without the cache or its callers knowing. */
export class InstrumentedLinkCache implements LinkCache {
  constructor(
    private readonly inner: LinkCache,
    private readonly metrics: Metrics,
  ) {}

  async get(code: string): Promise<CacheLookup> {
    const result = await this.inner.get(code);
    this.metrics.recordCacheLookup(result.status);
    return result;
  }

  set(code: string, target: RedirectTarget, ttlSeconds: number): Promise<void> {
    return this.inner.set(code, target, ttlSeconds);
  }

  markMissing(code: string): Promise<void> {
    return this.inner.markMissing(code);
  }

  delete(code: string): Promise<void> {
    return this.inner.delete(code);
  }
}
