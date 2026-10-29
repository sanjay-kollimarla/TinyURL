import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "../../application/ports";
import { DomainError, type ErrorCode, RateLimitedError } from "../../domain/errors";

const STATUS_BY_CODE: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  LINK_NOT_FOUND: 404,
  ALIAS_TAKEN: 409,
  LINK_EXPIRED: 410,
  RATE_LIMITED: 429,
};

export function errorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof DomainError) {
      if (err instanceof RateLimitedError) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json({ error: { code: err.code, message: err.message } }, STATUS_BY_CODE[err.code]);
    }
    logger.error({ err }, "unhandled error");
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  };
}
