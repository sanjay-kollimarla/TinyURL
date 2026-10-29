import { propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Config } from "../../config/env";

/**
 * Starts OTLP trace export when configured. Sampling honours an upstream
 * decision (traceparent) and otherwise samples a fixed ratio, which keeps the
 * hot path cheap. Returns null (and installs nothing) when tracing is disabled.
 */
export function initTracing(config: Config): { shutdown(): Promise<void> } | null {
  const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;

  const exporter = new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, "")}/v1/traces` });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.OTEL_SAMPLE_RATIO) }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  return { shutdown: () => provider.shutdown() };
}
