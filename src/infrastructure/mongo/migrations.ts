import type { Db } from "mongodb";

/**
 * Versioned, idempotent schema migrations. Applied versions are recorded in the
 * `migrations` collection. Every step is safe to re-run, so instances starting
 * concurrently during a rolling deploy cannot corrupt anything.
 * Append new migrations; never edit one that has shipped.
 */
interface Migration {
  readonly version: number;
  readonly name: string;
  run(db: Db): Promise<void>;
}

const LINK_SCHEMA = {
  bsonType: "object",
  required: ["_id", "longUrl", "urlHash", "custom", "createdAt", "expiresAt", "clickCount", "lastClickedAt"],
  properties: {
    _id: { bsonType: "string" },
    longUrl: { bsonType: "string", maxLength: 2048 },
    urlHash: { bsonType: "string" },
    custom: { bsonType: "bool" },
    dedupKey: { bsonType: "string" },
    createdAt: { bsonType: "date" },
    expiresAt: { bsonType: ["date", "null"] },
    clickCount: { bsonType: "number", minimum: 0 },
    lastClickedAt: { bsonType: ["date", "null"] },
  },
};

const CLICK_SCHEMA = {
  bsonType: "object",
  required: ["_id", "code", "at"],
  properties: {
    _id: { bsonType: "string" },
    code: { bsonType: "string" },
    at: { bsonType: "date" },
    referrer: { bsonType: ["string", "null"] },
    userAgent: { bsonType: ["string", "null"] },
  },
};

const NAMESPACE_EXISTS = 48;

async function applyValidator(db: Db, name: string, schema: object): Promise<void> {
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  const options = { validator: { $jsonSchema: schema }, validationLevel: "strict" as const };
  if (exists) {
    await db.command({ collMod: name, ...options });
    return;
  }
  try {
    await db.createCollection(name, options);
  } catch (err) {
    // A concurrent instance created it first; converge on the same validator.
    if ((err as { code?: number }).code !== NAMESPACE_EXISTS) throw err;
    await db.command({ collMod: name, ...options });
  }
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "collection-validators",
    async run(db) {
      await applyValidator(db, "links", LINK_SCHEMA);
      await applyValidator(db, "clicks", CLICK_SCHEMA);
    },
  },
  {
    version: 2,
    name: "core-indexes",
    async run(db) {
      const links = db.collection("links");
      const clicks = db.collection("clicks");
      await Promise.all([
        // Automated expiration. TTL ignores null, so permanent links are unaffected.
        links.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // Race-safe duplicate detection: one permanent generated link per URL.
        links.createIndex(
          { dedupKey: 1 },
          { unique: true, partialFilterExpression: { dedupKey: { $type: "string" } } },
        ),
        clicks.createIndex({ code: 1, at: -1 }),
      ]);
    },
  },
];

export async function runMigrations(db: Db): Promise<void> {
  const ledger = db.collection<{ _id: number; name: string; appliedAt: Date }>("migrations");
  const applied = new Set((await ledger.find().toArray()).map((m) => m._id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await migration.run(db);
    await ledger.updateOne(
      { _id: migration.version },
      { $setOnInsert: { name: migration.name, appliedAt: new Date() } },
      { upsert: true },
    );
  }
}

/**
 * Retention is configuration, not schema, so it is reconciled on every start:
 * the TTL index is created, or its lifetime updated in place if config changed.
 */
export async function applyClickRetention(db: Db, retentionDays: number): Promise<void> {
  const clicks = db.collection("clicks");
  const seconds = retentionDays * 86_400;
  const existing = (await clicks.indexes()).find((i) => i.name === "at_1");
  if (!existing) {
    await clicks.createIndex({ at: 1 }, { name: "at_1", expireAfterSeconds: seconds });
  } else if (existing.expireAfterSeconds !== seconds) {
    await db.command({ collMod: "clicks", index: { name: "at_1", expireAfterSeconds: seconds } });
  }
}
