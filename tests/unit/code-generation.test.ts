import { describe, expect, test } from "bun:test";
import { Base62CodeGenerator } from "../../src/infrastructure/id/base62-code-generator";
import { type BlockAllocator, BlockSequence } from "../../src/infrastructure/id/block-sequence";

class CountingAllocator implements BlockAllocator {
  next = 0;
  calls = 0;
  async allocate(size: number): Promise<number> {
    this.calls++;
    await Promise.resolve();
    const start = this.next;
    this.next += size;
    return start;
  }
}

describe("BlockSequence", () => {
  test("hits shared storage once per block", async () => {
    const allocator = new CountingAllocator();
    const sequence = new BlockSequence(allocator, 10);
    for (let i = 0; i < 25; i++) await sequence.nextId();
    expect(allocator.calls).toBe(3);
  });

  test("concurrent callers never receive the same id", async () => {
    const sequence = new BlockSequence(new CountingAllocator(), 7);
    const ids = await Promise.all(Array.from({ length: 500 }, () => sequence.nextId()));
    expect(new Set(ids).size).toBe(500);
  });

  test("two instances sharing an allocator never overlap", async () => {
    const allocator = new CountingAllocator();
    const a = new BlockSequence(allocator, 5);
    const b = new BlockSequence(allocator, 5);
    const ids = await Promise.all(Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).nextId()));
    expect(new Set(ids).size).toBe(200);
  });
});

describe("Base62CodeGenerator", () => {
  const generator = () => new Base62CodeGenerator(new BlockSequence(new CountingAllocator(), 1000), 7);

  test("produces fixed-length base62 codes", async () => {
    const g = generator();
    for (let i = 0; i < 100; i++) expect(await g.next()).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  test("is collision-free across many ids", async () => {
    const g = generator();
    const codes = new Set<string>();
    for (let i = 0; i < 50_000; i++) codes.add(await g.next());
    expect(codes.size).toBe(50_000);
  });

  test("consecutive ids do not yield sequential-looking codes", async () => {
    const g = generator();
    const [a, b] = [await g.next(), await g.next()];
    expect(a.slice(0, 4)).not.toBe(b.slice(0, 4));
  });

  test("throws once the code space is exhausted", async () => {
    const sequence = { nextId: async () => 62 ** 6 };
    await expect(new Base62CodeGenerator(sequence, 6).next()).rejects.toThrow(/exhausted/);
  });
});
