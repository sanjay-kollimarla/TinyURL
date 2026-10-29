import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import { applyClickRetention, runMigrations } from "../../src/infrastructure/mongo/migrations";
import type { LinkDocument } from "../../src/infrastructure/mongo/mongo";
import { dropDatabase, eventually, infrastructureAvailable, startApp, testConfig } from "./support";

const available = await infrastructureAvailable();

type Container = Awaited<ReturnType<typeof startApp>>;
type Created = { code: string; shortUrl: string };

describe.skipIf(!available)("service against real MongoDB and Redis", () => {
  const config = testConfig();
  let container: Container;
  let mongo: MongoClient;
  let redis: Redis;

  const post = (body: unknown) =>
    container.app.request("/api/v1/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const create = async (body: unknown) => (await (await post(body)).json()) as Created;

  beforeAll(async () => {
    container = await startApp(config);
    mongo = new MongoClient(config.MONGO_URI);
    await mongo.connect();
    redis = new Redis(config.REDIS_URL);
  });

  afterAll(async () => {
    await container.shutdown();
    await mongo.close();
    redis.disconnect();
    await dropDatabase(config);
  });

  test("create, redirect (populating Redis), stats, delete", async () => {
    const { code } = await create({ url: "https://example.com/e2e" });

    const redirect = await container.app.request(`/${code}`, { headers: { referer: "https://ref.test" } });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/e2e");
    expect(await redis.get(`link:${code}`)).toContain("https://example.com/e2e");

    await container.app.request(`/${code}`);
    await eventually(async () => {
      const stats = (await (await container.app.request(`/api/v1/links/${code}/stats`)).json()) as {
        totalClicks: number;
        daily: { clicks: number }[];
      };
      expect(stats.totalClicks).toBe(2);
      expect(stats.daily[0]?.clicks).toBe(2);
    });

    expect((await container.app.request(`/api/v1/links/${code}`, { method: "DELETE" })).status).toBe(204);
    expect((await container.app.request(`/${code}`)).status).toBe(404);
  });

  test("50 concurrent creates of the same URL converge on one link", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => create({ url: "https://example.com/race" })));
    expect(new Set(results.map((r) => r.code)).size).toBe(1);
    expect(
      await mongo.db(config.MONGO_DB).collection("links").countDocuments({ longUrl: "https://example.com/race" }),
    ).toBe(1);
  });

  test("a custom alias cannot be taken twice, even concurrently", async () => {
    const statuses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post({ url: `https://example.com/alias${i}`, alias: "contested" })),
    );
    expect(statuses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(statuses.filter((r) => r.status === 409)).toHaveLength(9);
  });

  test("two instances sharing a database never mint the same code", async () => {
    const second = await startApp(config);
    try {
      const createOn = async (c: Container, i: number) =>
        (await (
          await c.app.request("/api/v1/links", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: `https://example.com/multi/${i}` }),
          })
        ).json()) as Created;
      const codes = await Promise.all(Array.from({ length: 300 }, (_, i) => createOn(i % 2 ? container : second, i)));
      expect(new Set(codes.map((c) => c.code)).size).toBe(300);
    } finally {
      await second.shutdown();
    }
  });

  test("expired links return 410 and are not cached", async () => {
    const db = mongo.db(config.MONGO_DB);
    await db.collection<LinkDocument>("links").insertOne({
      _id: "expired1",
      longUrl: "https://example.com/old",
      urlHash: "x",
      custom: true,
      createdAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
      clickCount: 0,
      lastClickedAt: null,
    });
    expect((await container.app.request("/expired1")).status).toBe(410);
    expect(await redis.exists("link:expired1")).toBe(0);
  });

  test("migrations are idempotent and leave the expected indexes and validators", async () => {
    const db = mongo.db(config.MONGO_DB);
    await runMigrations(db);
    await runMigrations(db);
    expect(await db.collection("migrations").countDocuments()).toBe(2);

    const indexes = await db.collection("links").indexes();
    expect(indexes.find((i) => i.name === "expiresAt_1")?.expireAfterSeconds).toBe(0);
    expect(indexes.find((i) => i.name === "dedupKey_1")?.unique).toBe(true);

    await expect(db.collection("links").insertOne({ _id: "bad", longUrl: 42 } as never)).rejects.toThrow(/validation/i);
  });

  test("click retention is reconciled when configuration changes", async () => {
    const db = mongo.db(config.MONGO_DB);
    await applyClickRetention(db, 10);
    await applyClickRetention(db, 20);
    const ttl = (await db.collection("clicks").indexes()).find((i) => i.name === "at_1")?.expireAfterSeconds;
    expect(ttl).toBe(20 * 86_400);
  });

  test("readiness reports healthy, then unavailable while draining", async () => {
    expect((await container.app.request("/readyz")).status).toBe(200);
    const draining = await startApp(testConfig());
    draining.drain();
    expect((await draining.app.request("/readyz")).status).toBe(503);
    await draining.shutdown();
  });

  test("metrics endpoint reflects real traffic", async () => {
    const { code } = await create({ url: "https://example.com/metrics" });
    await container.app.request(`/${code}`);
    const text = await (await container.app.request("/metrics")).text();
    expect(text).toMatch(/tinyurl_cache_lookups_total\{outcome="(hit|miss)"\}/);
    expect(text).toContain('route="/:code"');
  });
});
