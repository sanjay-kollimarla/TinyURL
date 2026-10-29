import { type Collection, type Db, MongoClient } from "mongodb";
import type { Config } from "../../config/env";

export interface LinkDocument {
  _id: string;
  longUrl: string;
  urlHash: string;
  custom: boolean;
  /** Set only for permanent generated links; a unique partial index on it enforces one link per URL. */
  dedupKey?: string;
  createdAt: Date;
  expiresAt: Date | null;
  clickCount: number;
  lastClickedAt: Date | null;
}

export interface ClickDocument {
  _id: string;
  code: string;
  at: Date;
  referrer: string | null;
  userAgent: string | null;
}

export interface CounterDocument {
  _id: string;
  value: number;
}

export interface MongoCollections {
  readonly links: Collection<LinkDocument>;
  readonly clicks: Collection<ClickDocument>;
  readonly counters: Collection<CounterDocument>;
}

export function connectMongo(config: Config): MongoClient {
  return new MongoClient(config.MONGO_URI, {
    maxPoolSize: config.MONGO_MAX_POOL_SIZE,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    socketTimeoutMS: 10_000,
    retryWrites: true,
    writeConcern: { w: "majority", journal: true },
  });
}

export function collectionsOf(db: Db): MongoCollections {
  return {
    links: db.collection<LinkDocument>("links"),
    clicks: db.collection<ClickDocument>("clicks"),
    counters: db.collection<CounterDocument>("counters"),
  };
}
