import { ValidationError } from "./errors";

export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 5 * 365 * 24 * 3600;

export interface ExpirationRequest {
  readonly ttlSeconds?: number | undefined;
  readonly expiresAt?: Date | undefined;
}

/** Resolves an expiration policy into an absolute instant, or null for "never". */
export function resolveExpiry(request: ExpirationRequest, now: Date): Date | null {
  const { ttlSeconds, expiresAt } = request;
  if (ttlSeconds !== undefined && expiresAt !== undefined) {
    throw new ValidationError("Provide either ttlSeconds or expiresAt, not both");
  }
  if (ttlSeconds === undefined && expiresAt === undefined) return null;

  const target = expiresAt ?? new Date(now.getTime() + (ttlSeconds as number) * 1000);
  const remaining = (target.getTime() - now.getTime()) / 1000;
  if (remaining < MIN_TTL_SECONDS) {
    throw new ValidationError(`Expiration must be at least ${MIN_TTL_SECONDS} seconds in the future`);
  }
  if (remaining > MAX_TTL_SECONDS) {
    throw new ValidationError("Expiration must be within 5 years");
  }
  return target;
}
