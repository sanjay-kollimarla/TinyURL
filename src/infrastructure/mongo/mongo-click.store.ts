import { type AnyBulkWriteOperation, MongoBulkWriteError } from "mongodb";
import type { ClickEvent, ClickStore, DailyClicks } from "../../application/ports";
import type { ClickDocument, LinkDocument, MongoCollections } from "./mongo";

const DUPLICATE_KEY = 11000;

export class MongoClickStore implements ClickStore {
  constructor(private readonly collections: MongoCollections) {}

  async recordBatch(events: readonly ClickEvent[]): Promise<void> {
    if (events.length === 0) return;
    await Promise.all([this.insertEvents(events), this.incrementCounters(events)]);
  }

  async dailyBreakdown(code: string, since: Date): Promise<DailyClicks[]> {
    const rows = await this.collections.clicks
      .aggregate<{ _id: string; clicks: number }>([
        { $match: { code, at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, clicks: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    return rows.map((r) => ({ date: r._id, clicks: r.clicks }));
  }

  /** Event ids make retries idempotent: re-inserted duplicates are ignored. */
  private async insertEvents(events: readonly ClickEvent[]): Promise<void> {
    const docs: ClickDocument[] = events.map((e) => ({
      _id: e.id,
      code: e.code,
      at: e.at,
      referrer: e.referrer,
      userAgent: e.userAgent,
    }));
    try {
      await this.collections.clicks.insertMany(docs, { ordered: false });
    } catch (err) {
      const onlyDuplicates =
        err instanceof MongoBulkWriteError && Object.values(err.writeErrors ?? []).every(isDuplicate);
      if (!onlyDuplicates) throw err;
    }
  }

  private async incrementCounters(events: readonly ClickEvent[]): Promise<void> {
    const perCode = new Map<string, { count: number; last: Date }>();
    for (const { code, at } of events) {
      const agg = perCode.get(code);
      if (agg) {
        agg.count++;
        if (at > agg.last) agg.last = at;
      } else {
        perCode.set(code, { count: 1, last: at });
      }
    }

    const ops: AnyBulkWriteOperation<LinkDocument>[] = [...perCode].map(([code, { count, last }]) => ({
      updateOne: {
        filter: { _id: code },
        update: { $inc: { clickCount: count }, $max: { lastClickedAt: last } },
      },
    }));
    await this.collections.links.bulkWrite(ops, { ordered: false });
  }
}

function isDuplicate(error: { code?: number }): boolean {
  return error.code === DUPLICATE_KEY;
}
