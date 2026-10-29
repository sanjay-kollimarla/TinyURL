import { describe, expect, test } from "bun:test";
import { CircuitBreaker, CircuitOpenError } from "../../src/infrastructure/resilience/circuit-breaker";
import { clientKey } from "../../src/interfaces/http/middleware";

describe("CircuitBreaker", () => {
  const fail = () => Promise.reject(new Error("redis down"));
  const ok = () => Promise.resolve("ok");

  function setup() {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, now: () => now });
    return { breaker, advance: (ms: number) => (now += ms) };
  }

  test("opens after the threshold and then fails fast without calling the task", async () => {
    const { breaker } = setup();
    for (let i = 0; i < 3; i++) await breaker.exec(fail).catch(() => {});
    expect(breaker.state).toBe("open");

    let called = false;
    await expect(
      breaker.exec(async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  test("a success resets the failure count", async () => {
    const { breaker } = setup();
    await breaker.exec(fail).catch(() => {});
    await breaker.exec(fail).catch(() => {});
    await breaker.exec(ok);
    await breaker.exec(fail).catch(() => {});
    expect(breaker.state).toBe("closed");
  });

  test("half-open allows one trial; success closes the circuit", async () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) await breaker.exec(fail).catch(() => {});
    advance(1000);
    expect(breaker.state).toBe("half-open");

    let release!: () => void;
    const trial = breaker.exec(() => new Promise<string>((r) => (release = () => r("ok"))));
    await expect(breaker.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError); // only one trial at a time
    release();
    await trial;
    expect(breaker.state).toBe("closed");
  });

  test("a failed trial re-opens the circuit", async () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) await breaker.exec(fail).catch(() => {});
    advance(1000);
    await breaker.exec(fail).catch(() => {});
    expect(breaker.state).toBe("open");
  });
});

describe("clientKey", () => {
  test("ignores x-forwarded-for unless the proxy is trusted", () => {
    expect(clientKey("6.6.6.6", "10.0.0.1", false)).toBe("10.0.0.1");
  });

  test("uses the last hop, which our own proxy appended, when trusted", () => {
    expect(clientKey("6.6.6.6, 203.0.113.9", "10.0.0.1", true)).toBe("203.0.113.9");
  });

  test("falls back to the socket address", () => {
    expect(clientKey(undefined, "10.0.0.1", true)).toBe("10.0.0.1");
    expect(clientKey(undefined, undefined, false)).toBe("unknown");
  });
});
