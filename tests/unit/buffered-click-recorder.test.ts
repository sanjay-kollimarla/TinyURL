import { describe, expect, test } from "bun:test";
import { BufferedClickRecorder } from "../../src/application/buffered-click-recorder";
import type { ClickEvent } from "../../src/application/ports";
import { InMemoryClickStore, silentLogger } from "./fakes";

const event = (n: number): ClickEvent => ({
  id: `e${n}`,
  code: "abc1234",
  at: new Date(),
  referrer: null,
  userAgent: null,
});

const options = { batchSize: 3, flushIntervalMs: 60_000, maxBuffered: 10 };

describe("BufferedClickRecorder", () => {
  test("flushes automatically when a batch fills", async () => {
    const store = new InMemoryClickStore();
    const recorder = new BufferedClickRecorder(store, silentLogger, options);
    for (let i = 0; i < 3; i++) recorder.record(event(i));
    await recorder.flush();
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]).toHaveLength(3);
  });

  test("stop drains everything that is buffered", async () => {
    const store = new InMemoryClickStore();
    const recorder = new BufferedClickRecorder(store, silentLogger, options);
    for (let i = 0; i < 8; i++) recorder.record(event(i));
    await recorder.stop();
    expect(store.batches.flat()).toHaveLength(8);
  });

  test("requeues a failed batch and delivers it on the next flush", async () => {
    const store = new InMemoryClickStore();
    const recorder = new BufferedClickRecorder(store, silentLogger, options);
    recorder.record(event(1));
    store.failNext = true;
    await recorder.flush();
    expect(store.batches).toHaveLength(0);
    await recorder.flush();
    expect(store.batches.flat().map((e) => e.id)).toEqual(["e1"]);
  });

  test("sheds events beyond the buffer cap", async () => {
    const store = new InMemoryClickStore();
    const recorder = new BufferedClickRecorder(store, silentLogger, { ...options, batchSize: 100 });
    for (let i = 0; i < 25; i++) recorder.record(event(i));
    await recorder.stop();
    expect(store.batches.flat()).toHaveLength(10);
  });
});
