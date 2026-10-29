import { LinkExpiredError, LinkNotFoundError } from "../domain/errors";
import { isExpiredAt, type RedirectTarget, toRedirectTarget } from "../domain/link";
import type { ClickRecorder, Clock, LinkCache, LinkRepository } from "./ports";
import { SingleFlight } from "./single-flight";

export interface RedirectOptions {
  readonly cacheTtlSeconds: number;
}

export interface RequestMeta {
  readonly referrer: string | null;
  readonly userAgent: string | null;
}

/**
 * Hot path. Cache-aside lookup with negative caching and request coalescing;
 * click analytics are handed off without awaiting.
 */
export class RedirectService {
  private readonly loads = new SingleFlight<string, RedirectTarget>();

  constructor(
    private readonly links: LinkRepository,
    private readonly cache: LinkCache,
    private readonly clicks: ClickRecorder,
    private readonly clock: Clock,
    private readonly options: RedirectOptions,
  ) {}

  async resolve(code: string, meta: RequestMeta): Promise<string> {
    const target = await this.lookup(code);
    this.clicks.record({
      id: crypto.randomUUID(),
      code,
      at: this.clock.now(),
      referrer: meta.referrer,
      userAgent: meta.userAgent,
    });
    return target.longUrl;
  }

  private async lookup(code: string): Promise<RedirectTarget> {
    const cached = await this.cache.get(code);
    switch (cached.status) {
      case "negative":
        throw new LinkNotFoundError(code);
      case "hit":
        if (isExpiredAt(cached.target.expiresAt, this.clock.now().getTime())) {
          await this.cache.delete(code);
          throw new LinkExpiredError(code);
        }
        return cached.target;
      case "miss":
        return this.loads.run(code, () => this.loadFromSource(code));
    }
  }

  private async loadFromSource(code: string): Promise<RedirectTarget> {
    const link = await this.links.findByCode(code);
    if (!link) {
      await this.cache.markMissing(code);
      throw new LinkNotFoundError(code);
    }

    const now = this.clock.now().getTime();
    const target = toRedirectTarget(link);
    if (isExpiredAt(target.expiresAt, now)) throw new LinkExpiredError(code);

    await this.cache.set(code, target, this.cacheTtl(target.expiresAt, now));
    return target;
  }

  /** Never cache past the link's own expiry. */
  private cacheTtl(expiresAt: number | null, nowMs: number): number {
    if (expiresAt === null) return this.options.cacheTtlSeconds;
    const remaining = Math.max(1, Math.floor((expiresAt - nowMs) / 1000));
    return Math.min(this.options.cacheTtlSeconds, remaining);
  }
}
