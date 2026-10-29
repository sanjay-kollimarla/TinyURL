import type {
  CacheLookup,
  ClickEvent,
  ClickRecorder,
  ClickStore,
  Clock,
  CodeGenerator,
  DailyClicks,
  InsertResult,
  LinkCache,
  LinkRepository,
  Logger,
  RateLimiter,
} from "../../src/application/ports";
import type { Link, RedirectTarget } from "../../src/domain/link";

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export class FakeClock implements Clock {
  constructor(private current = new Date("2026-01-01T00:00:00Z")) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class InMemoryLinkRepository implements LinkRepository {
  readonly store = new Map<string, Link>();
  findByCodeCalls = 0;

  async insert(link: Link): Promise<InsertResult> {
    if (this.store.has(link.code)) return { status: "duplicate-code" };
    const dedupable = !link.custom && link.expiresAt === null;
    if (dedupable && (await this.findPermanentByUrlHash(link.urlHash))) return { status: "duplicate-url" };
    this.store.set(link.code, link);
    return { status: "inserted" };
  }

  async findByCode(code: string): Promise<Link | null> {
    this.findByCodeCalls++;
    return this.store.get(code) ?? null;
  }

  async findPermanentByUrlHash(urlHash: string): Promise<Link | null> {
    return [...this.store.values()].find((l) => l.urlHash === urlHash && !l.custom && l.expiresAt === null) ?? null;
  }

  async deleteByCode(code: string): Promise<boolean> {
    return this.store.delete(code);
  }
}

export class InMemoryLinkCache implements LinkCache {
  readonly entries = new Map<string, RedirectTarget | "negative">();
  readonly ttls = new Map<string, number>();

  async get(code: string): Promise<CacheLookup> {
    const entry = this.entries.get(code);
    if (entry === undefined) return { status: "miss" };
    return entry === "negative" ? { status: "negative" } : { status: "hit", target: entry };
  }
  async set(code: string, target: RedirectTarget, ttlSeconds: number): Promise<void> {
    this.entries.set(code, target);
    this.ttls.set(code, ttlSeconds);
  }
  async markMissing(code: string): Promise<void> {
    this.entries.set(code, "negative");
  }
  async delete(code: string): Promise<void> {
    this.entries.delete(code);
  }
}

export class SequentialCodes implements CodeGenerator {
  private n = 0;
  async next(): Promise<string> {
    return `code${++this.n}`;
  }
}

export class CollectingRecorder implements ClickRecorder {
  readonly events: ClickEvent[] = [];
  record(event: ClickEvent): void {
    this.events.push(event);
  }
}

export class InMemoryClickStore implements ClickStore {
  readonly batches: ClickEvent[][] = [];
  failNext = false;
  async recordBatch(events: readonly ClickEvent[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("db down");
    }
    this.batches.push([...events]);
  }
  async dailyBreakdown(): Promise<DailyClicks[]> {
    return [{ date: "2026-01-01", clicks: this.batches.flat().length }];
  }
}

export const allowAllLimiter: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: 99, retryAfterSeconds: 0 }),
};
