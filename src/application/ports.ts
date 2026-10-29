import type { Link, RedirectTarget } from "../domain/link";

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface Clock {
  now(): Date;
}

export type InsertResult =
  | { readonly status: "inserted" }
  | { readonly status: "duplicate-code" }
  | { readonly status: "duplicate-url" };

export interface LinkRepository {
  /** Never throws for uniqueness violations; reports them in the result. */
  insert(link: Link): Promise<InsertResult>;
  findByCode(code: string): Promise<Link | null>;
  /** Finds the shared, non-expiring, generated link for a URL (duplicate detection). */
  findPermanentByUrlHash(urlHash: string): Promise<Link | null>;
  deleteByCode(code: string): Promise<boolean>;
}

export type CacheLookup =
  | { readonly status: "hit"; readonly target: RedirectTarget }
  | { readonly status: "negative" }
  | { readonly status: "miss" };

/** Implementations must degrade to "miss" rather than throw when the backing store is down. */
export interface LinkCache {
  get(code: string): Promise<CacheLookup>;
  set(code: string, target: RedirectTarget, ttlSeconds: number): Promise<void>;
  markMissing(code: string): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface ClickEvent {
  readonly id: string;
  readonly code: string;
  readonly at: Date;
  readonly referrer: string | null;
  readonly userAgent: string | null;
}

export interface DailyClicks {
  readonly date: string;
  readonly clicks: number;
}

export interface ClickStore {
  recordBatch(events: readonly ClickEvent[]): Promise<void>;
  dailyBreakdown(code: string, since: Date): Promise<DailyClicks[]>;
}

/** Non-blocking sink used on the redirect hot path. */
export interface ClickRecorder {
  record(event: ClickEvent): void;
}

export interface CodeGenerator {
  next(): Promise<string>;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>;
}
