import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { RateLimiter } from "../../application/ports";
import { RateLimitedError, UnauthorizedError } from "../../domain/errors";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** No-op when no key is configured, so local development stays frictionless. */
export function apiKeyAuth(apiKey: string | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (apiKey === undefined) return next();
    const provided = c.req.header("x-api-key");
    if (provided === undefined || !safeEqual(provided, apiKey)) throw new UnauthorizedError();
    return next();
  };
}

/** Per-request values supplied by the server adapter (see main.ts). */
export type AppEnv = { Bindings: { ip?: string | undefined } };

/**
 * Identifies the caller for rate limiting. `x-forwarded-for` is attacker-controlled
 * unless a trusted proxy appends to it, so it is honoured only when configured, and
 * then only its last entry (the hop our own proxy observed) is used.
 */
export function clientKey(forwardedFor: string | undefined, socketIp: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor) {
    const lastHop = forwardedFor.split(",").at(-1)?.trim();
    if (lastHop) return lastHop;
  }
  return socketIp ?? "unknown";
}

export function rateLimit(limiter: RateLimiter, trustProxy: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = clientKey(c.req.header("x-forwarded-for"), c.env?.ip, trustProxy);
    const decision = await limiter.consume(key);
    c.header("X-RateLimit-Remaining", String(decision.remaining));
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    return next();
  };
}
