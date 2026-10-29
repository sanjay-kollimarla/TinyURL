import { MongoClient } from "mongodb";
import { type Config, loadConfig } from "../../src/config/env";
import { buildContainer } from "../../src/container";

export const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017";
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Integration tests need real MongoDB and Redis. Locally they skip when the
 * services are down; CI sets REQUIRE_INTEGRATION=1 so a missing service fails the build.
 */
export async function infrastructureAvailable(): Promise<boolean> {
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    return true;
  } catch (err) {
    if (process.env.REQUIRE_INTEGRATION) throw err;
    return false;
  } finally {
    await client.close();
  }
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGO_URI,
    MONGO_DB: `tinyurl_it_${crypto.randomUUID().slice(0, 8)}`,
    REDIS_URL,
    BASE_URL: "http://short.test",
    ANALYTICS_FLUSH_INTERVAL_MS: "100",
    RATE_LIMIT_MAX: "100000",
    ...overrides,
  });
}

export async function startApp(config: Config) {
  return buildContainer(config);
}

export async function dropDatabase(config: Config): Promise<void> {
  const client = new MongoClient(config.MONGO_URI);
  try {
    await client.db(config.MONGO_DB).dropDatabase();
  } finally {
    await client.close();
  }
}

export async function eventually(assertion: () => Promise<void>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await assertion();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await Bun.sleep(50);
    }
  }
}
