import type { MiddlewareHandler } from "hono";
import type { Logger } from "../../application/ports";

/** Propagates (or mints) a correlation id and logs one access line per API request. */
export function requestContext(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("X-Request-Id", requestId);
    const started = performance.now();
    await next();
    logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
  };
}
