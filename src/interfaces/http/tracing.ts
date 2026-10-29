import { propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

const headerGetter = {
  get: (carrier: Headers, key: string) => carrier.get(key) ?? undefined,
  keys: (carrier: Headers) => [...carrier.keys()],
};

/** One server span per request, continuing the caller's W3C trace when present. */
export function tracing(): MiddlewareHandler {
  const tracer = trace.getTracer("tinyurl-http");
  return async (c, next) => {
    const parent = propagation.extract(ROOT_CONTEXT, c.req.raw.headers, headerGetter);
    const span = tracer.startSpan(c.req.method, { kind: SpanKind.SERVER }, parent);
    try {
      await next();
      span.updateName(`${c.req.method} ${c.req.routePath}`);
      span.setAttributes({ "http.request.method": c.req.method, "http.response.status_code": c.res.status });
      if (c.error) span.recordException(c.error);
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    } finally {
      span.end();
    }
  };
}
