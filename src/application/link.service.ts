import { AliasTakenError, LinkNotFoundError } from "../domain/errors";
import { type ExpirationRequest, resolveExpiry } from "../domain/expiration";
import { isExpiredAt, type Link } from "../domain/link";
import { hashUrl, normalizeUrl, validateAlias } from "../domain/url";
import type { ClickStore, Clock, CodeGenerator, DailyClicks, LinkCache, LinkRepository } from "./ports";

const MAX_CODE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

export interface CreateLinkCommand extends ExpirationRequest {
  readonly longUrl: string;
  readonly alias?: string | undefined;
}

export interface CreateLinkResult {
  readonly link: Link;
  /** False when an existing link was returned by duplicate detection. */
  readonly created: boolean;
}

export interface LinkStats {
  readonly link: Link;
  readonly daily: DailyClicks[];
}

export class LinkService {
  constructor(
    private readonly links: LinkRepository,
    private readonly cache: LinkCache,
    private readonly clickStore: ClickStore,
    private readonly codes: CodeGenerator,
    private readonly clock: Clock,
    /** Host (with port) of this service, used to reject self-referencing links. */
    private readonly selfHost: string,
  ) {}

  async create(command: CreateLinkCommand): Promise<CreateLinkResult> {
    const now = this.clock.now();
    const longUrl = normalizeUrl(command.longUrl, this.selfHost);
    const expiresAt = resolveExpiry(command, now);
    const urlHash = hashUrl(longUrl);

    if (command.alias !== undefined) {
      const alias = validateAlias(command.alias);
      const link = this.build({ code: alias, longUrl, urlHash, custom: true, expiresAt, now });
      const result = await this.links.insert(link);
      if (result.status !== "inserted") throw new AliasTakenError(alias);
      await this.cache.delete(alias);
      return { link, created: true };
    }

    if (expiresAt === null) {
      const existing = await this.links.findPermanentByUrlHash(urlHash);
      if (existing) return { link: existing, created: false };
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = await this.codes.next();
      const link = this.build({ code, longUrl, urlHash, custom: false, expiresAt, now });
      const result = await this.links.insert(link);

      if (result.status === "inserted") {
        await this.cache.delete(code);
        return { link, created: true };
      }
      if (result.status === "duplicate-url") {
        // Lost a race with a concurrent identical request; converge on the winner.
        const winner = await this.links.findPermanentByUrlHash(urlHash);
        if (winner) return { link: winner, created: false };
      }
      // duplicate-code: a custom alias squats this generated code; try the next one.
    }
    throw new Error("Unable to allocate a unique short code");
  }

  async getStats(code: string, days: number): Promise<LinkStats> {
    const link = await this.links.findByCode(code);
    const now = this.clock.now();
    if (!link || isExpiredAt(link.expiresAt?.getTime() ?? null, now.getTime())) {
      throw new LinkNotFoundError(code);
    }
    const daily = await this.clickStore.dailyBreakdown(code, new Date(now.getTime() - days * DAY_MS));
    return { link, daily };
  }

  async delete(code: string): Promise<void> {
    const deleted = await this.links.deleteByCode(code);
    if (!deleted) throw new LinkNotFoundError(code);
    await this.cache.markMissing(code);
  }

  private build(input: {
    code: string;
    longUrl: string;
    urlHash: string;
    custom: boolean;
    expiresAt: Date | null;
    now: Date;
  }): Link {
    return {
      code: input.code,
      longUrl: input.longUrl,
      urlHash: input.urlHash,
      custom: input.custom,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      clickCount: 0,
      lastClickedAt: null,
    };
  }
}
