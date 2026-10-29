import type { Collection } from "mongodb";
import type { BlockAllocator } from "../id/block-sequence";
import type { CounterDocument } from "./mongo";

const COUNTER_ID = "link-code";

export class MongoBlockAllocator implements BlockAllocator {
  constructor(private readonly counters: Collection<CounterDocument>) {}

  async allocate(size: number): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { _id: COUNTER_ID },
      { $inc: { value: size } },
      { upsert: true, returnDocument: "after" },
    );
    if (!doc) throw new Error("Failed to allocate id block");
    return doc.value - size;
  }
}
