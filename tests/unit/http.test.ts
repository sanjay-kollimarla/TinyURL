import { beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { LinkService } from "../../src/application/link.service";
import { RedirectService } from "../../src/application/redirect.service";
import { createApp } from "../../src/interfaces/http/app";
import type { AppEnv } from "../../src/interfaces/http/middleware";
import {
  allowAllLimiter,
  CollectingRecorder,
  FakeClock,
  InMemoryClickStore,
  InMemoryLinkCache,
  InMemoryLinkRepository,
  SequentialCodes,
  silentLogger,
} from "./fakes";

function buildApp(apiKey?: string): Hono<AppEnv> {
  const repo = new InMemoryLinkRepository();
  const cache = new InMemoryLinkCache();
  const clock = new FakeClock();
  return createApp({
    linkService: new LinkService(repo, cache, new InMemoryClickStore(), new SequentialCodes(), clock, "short.test"),
    redirectService: new RedirectService(repo, cache, new CollectingRecorder(), clock, { cacheTtlSeconds: 60 }),
    rateLimiter: allowAllLimiter,
    logger: silentLogger,
    baseUrl: "https://short.test/",
    apiKey,
    trustProxy: false,
    checkReadiness: async () => {},
  });
}

const post = (app: Hono<AppEnv>, body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/v1/links", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("HTTP API", () => {
  let app: Hono<AppEnv>;
  beforeEach(() => {
    app = buildApp();
  });

  test("create then redirect", async () => {
    const created = await post(app, { url: "https://example.com/page" });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { code: string; shortUrl: string };
    expect(body.shortUrl).toBe(`https://short.test/${body.code}`);

    const redirect = await app.request(`/${body.code}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/page");
  });

  test("duplicate URL returns 200 with the same code", async () => {
    const first = (await (await post(app, { url: "https://example.com/x" })).json()) as { code: string };
    const again = await post(app, { url: "https://example.com/x" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { code: string }).code).toBe(first.code);
  });

  test("unknown code is 404", async () => {
    expect((await app.request("/zzzzzzz")).status).toBe(404);
  });

  test("taken alias is 409", async () => {
    await post(app, { url: "https://example.com/a", alias: "promo" });
    expect((await post(app, { url: "https://example.com/b", alias: "promo" })).status).toBe(409);
  });

  test("invalid payloads are 400", async () => {
    expect((await post(app, { nope: true })).status).toBe(400);
    expect((await post(app, { url: "javascript:alert(1)" })).status).toBe(400);
    const badJson = await app.request("/api/v1/links", { method: "POST", body: "{" });
    expect(badJson.status).toBe(400);
  });

  test("delete makes the link unreachable", async () => {
    const { code } = (await (await post(app, { url: "https://example.com/d" })).json()) as { code: string };
    expect((await app.request(`/api/v1/links/${code}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/${code}`)).status).toBe(404);
  });

  test("stats expose totals and daily breakdown", async () => {
    const { code } = (await (await post(app, { url: "https://example.com/s" })).json()) as { code: string };
    const res = await app.request(`/api/v1/links/${code}/stats?days=7`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code, totalClicks: 0, daily: expect.any(Array) });
  });

  test("home page is served and unknown routes return JSON 404", async () => {
    const home = await app.request("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    const missing = await app.request("/api/v1/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("serves the favicon and credits the author on the home page", async () => {
    for (const path of ["/favicon.svg", "/favicon.ico"]) {
      const icon = await app.request(path);
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    }
    const html = await (await app.request("/")).text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain("Sanjay Kollimarla");
  });

  test("health endpoints respond", async () => {
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/readyz")).status).toBe(200);
  });

  test("API key is enforced on /api/v1 but not on redirects", async () => {
    const secured = buildApp("secret-key-123");
    expect((await post(secured, { url: "https://example.com/a" })).status).toBe(401);
    const ok = await post(secured, { url: "https://example.com/a" }, { "x-api-key": "secret-key-123" });
    expect(ok.status).toBe(201);
    const { code } = (await ok.json()) as { code: string };
    expect((await secured.request(`/${code}`)).status).toBe(302);
  });
});
