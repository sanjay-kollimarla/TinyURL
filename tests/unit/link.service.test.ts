import { beforeEach, describe, expect, test } from "bun:test";
import { LinkService } from "../../src/application/link.service";
import { AliasTakenError, LinkNotFoundError, ValidationError } from "../../src/domain/errors";
import { FakeClock, InMemoryClickStore, InMemoryLinkCache, InMemoryLinkRepository, SequentialCodes } from "./fakes";

describe("LinkService.create", () => {
  let repo: InMemoryLinkRepository;
  let cache: InMemoryLinkCache;
  let clock: FakeClock;
  let service: LinkService;

  beforeEach(() => {
    repo = new InMemoryLinkRepository();
    cache = new InMemoryLinkCache();
    clock = new FakeClock();
    service = new LinkService(repo, cache, new InMemoryClickStore(), new SequentialCodes(), clock, "short.test");
  });

  test("creates a link with a generated code", async () => {
    const { link, created } = await service.create({ longUrl: "https://example.com/a" });
    expect(created).toBe(true);
    expect(link.code).toBe("code1");
    expect(link.expiresAt).toBeNull();
  });

  test("returns the existing link for a duplicate URL", async () => {
    const first = await service.create({ longUrl: "https://example.com/a" });
    const second = await service.create({ longUrl: "HTTPS://EXAMPLE.com/a" });
    expect(second.created).toBe(false);
    expect(second.link.code).toBe(first.link.code);
  });

  test("does not deduplicate expiring links", async () => {
    const a = await service.create({ longUrl: "https://example.com/a", ttlSeconds: 3600 });
    const b = await service.create({ longUrl: "https://example.com/a", ttlSeconds: 3600 });
    expect(a.link.code).not.toBe(b.link.code);
  });

  test("computes expiry from ttlSeconds", async () => {
    const { link } = await service.create({ longUrl: "https://example.com/a", ttlSeconds: 3600 });
    expect(link.expiresAt?.getTime()).toBe(clock.now().getTime() + 3_600_000);
  });

  test("honours custom aliases and rejects taken ones", async () => {
    const { link } = await service.create({ longUrl: "https://example.com/a", alias: "my-link" });
    expect(link.code).toBe("my-link");
    await expect(service.create({ longUrl: "https://example.com/b", alias: "my-link" })).rejects.toBeInstanceOf(
      AliasTakenError,
    );
  });

  test("skips generated codes squatted by an alias", async () => {
    await service.create({ longUrl: "https://example.com/a", alias: "code1" });
    const { link } = await service.create({ longUrl: "https://example.com/b" });
    expect(link.code).toBe("code2");
  });

  test.each([
    ["non-http scheme", { longUrl: "ftp://example.com" }],
    ["malformed url", { longUrl: "not a url" }],
    ["self reference", { longUrl: "https://short.test/abc" }],
    ["embedded credentials", { longUrl: "https://user:pw@example.com" }],
    ["reserved alias", { longUrl: "https://example.com", alias: "api" }],
    ["bad alias chars", { longUrl: "https://example.com", alias: "no spaces" }],
    ["past expiry", { longUrl: "https://example.com", ttlSeconds: 5 }],
    [
      "ttl and expiresAt together",
      { longUrl: "https://example.com", ttlSeconds: 600, expiresAt: new Date("2030-01-01") },
    ],
  ])("rejects %s", async (_name, command) => {
    await expect(service.create(command)).rejects.toBeInstanceOf(ValidationError);
  });

  test("delete removes the link and negative-caches the code", async () => {
    const { link } = await service.create({ longUrl: "https://example.com/a" });
    await service.delete(link.code);
    expect(repo.store.has(link.code)).toBe(false);
    expect(cache.entries.get(link.code)).toBe("negative");
    await expect(service.delete(link.code)).rejects.toBeInstanceOf(LinkNotFoundError);
  });

  test("stats are unavailable for expired links", async () => {
    const { link } = await service.create({ longUrl: "https://example.com/a", ttlSeconds: 120 });
    clock.advance(121_000);
    await expect(service.getStats(link.code, 7)).rejects.toBeInstanceOf(LinkNotFoundError);
  });
});
