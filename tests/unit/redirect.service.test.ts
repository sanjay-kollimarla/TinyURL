import { beforeEach, describe, expect, test } from "bun:test";
import { RedirectService } from "../../src/application/redirect.service";
import { LinkExpiredError, LinkNotFoundError } from "../../src/domain/errors";
import type { Link } from "../../src/domain/link";
import { CollectingRecorder, FakeClock, InMemoryLinkCache, InMemoryLinkRepository } from "./fakes";

const meta = { referrer: "https://ref.test", userAgent: "bun-test" };

function link(overrides: Partial<Link> = {}): Link {
  return {
    code: "abc1234",
    longUrl: "https://example.com/target",
    urlHash: "h",
    custom: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    clickCount: 0,
    lastClickedAt: null,
    ...overrides,
  };
}

describe("RedirectService", () => {
  let repo: InMemoryLinkRepository;
  let cache: InMemoryLinkCache;
  let recorder: CollectingRecorder;
  let clock: FakeClock;
  let service: RedirectService;

  beforeEach(() => {
    repo = new InMemoryLinkRepository();
    cache = new InMemoryLinkCache();
    recorder = new CollectingRecorder();
    clock = new FakeClock();
    service = new RedirectService(repo, cache, recorder, clock, { cacheTtlSeconds: 3600 });
  });

  test("loads from the repository on a miss, then serves from cache", async () => {
    repo.store.set("abc1234", link());
    expect(await service.resolve("abc1234", meta)).toBe("https://example.com/target");
    expect(await service.resolve("abc1234", meta)).toBe("https://example.com/target");
    expect(repo.findByCodeCalls).toBe(1);
  });

  test("records a click per redirect", async () => {
    repo.store.set("abc1234", link());
    await service.resolve("abc1234", meta);
    await service.resolve("abc1234", meta);
    expect(recorder.events).toHaveLength(2);
    expect(recorder.events[0]).toMatchObject({ code: "abc1234", referrer: "https://ref.test" });
  });

  test("coalesces concurrent misses into one database read", async () => {
    repo.store.set("abc1234", link());
    await Promise.all(Array.from({ length: 50 }, () => service.resolve("abc1234", meta)));
    expect(repo.findByCodeCalls).toBe(1);
  });

  test("negative-caches unknown codes", async () => {
    await expect(service.resolve("nope123", meta)).rejects.toBeInstanceOf(LinkNotFoundError);
    await expect(service.resolve("nope123", meta)).rejects.toBeInstanceOf(LinkNotFoundError);
    expect(repo.findByCodeCalls).toBe(1);
    expect(recorder.events).toHaveLength(0);
  });

  test("rejects expired links without caching them", async () => {
    repo.store.set("abc1234", link({ expiresAt: new Date(clock.now().getTime() - 1) }));
    await expect(service.resolve("abc1234", meta)).rejects.toBeInstanceOf(LinkExpiredError);
    expect(cache.entries.has("abc1234")).toBe(false);
  });

  test("caps cache TTL at the link's remaining lifetime", async () => {
    repo.store.set("abc1234", link({ expiresAt: new Date(clock.now().getTime() + 90_000) }));
    await service.resolve("abc1234", meta);
    expect(cache.ttls.get("abc1234")).toBe(90);
  });

  test("evicts and rejects a cached entry once it expires", async () => {
    repo.store.set("abc1234", link({ expiresAt: new Date(clock.now().getTime() + 90_000) }));
    await service.resolve("abc1234", meta);
    clock.advance(91_000);
    await expect(service.resolve("abc1234", meta)).rejects.toBeInstanceOf(LinkExpiredError);
    expect(cache.entries.has("abc1234")).toBe(false);
  });
});
