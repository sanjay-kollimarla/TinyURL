import { describe, expect, test } from "bun:test";
import { dropDatabase, eventually, infrastructureAvailable, startApp, testConfig } from "./support";

const available = await infrastructureAvailable();

describe.skipIf(!available)("OpenTelemetry export", () => {
  test("exports a server span to the OTLP endpoint and continues an incoming trace", async () => {
    const received: { path: string; bytes: number }[] = [];
    const collector = Bun.serve({
      port: 0,
      async fetch(request) {
        received.push({ path: new URL(request.url).pathname, bytes: (await request.arrayBuffer()).byteLength });
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    });

    const config = testConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${collector.port}`,
      OTEL_SAMPLE_RATIO: "1",
    });
    const container = await startApp(config);
    try {
      await container.app.request("/healthz", {
        headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
      });
    } finally {
      await container.shutdown(); // flushes the batch span processor
      await dropDatabase(config);
    }

    await eventually(async () => {
      const trace = received.find((r) => r.path === "/v1/traces");
      expect(trace?.bytes).toBeGreaterThan(0);
    });
    collector.stop(true);
  });

  test("tracing stays off without an endpoint", async () => {
    const config = testConfig();
    const container = await startApp(config);
    try {
      expect((await container.app.request("/healthz")).status).toBe(200);
    } finally {
      await container.shutdown();
      await dropDatabase(config);
    }
  });
});
