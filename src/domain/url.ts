import { createHash } from "node:crypto";
import { ValidationError } from "./errors";

const MAX_URL_LENGTH = 2048;
const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED_ALIASES = new Set(["api", "healthz", "readyz", "metrics", "admin", "static"]);

/**
 * Validates and canonicalises a destination URL so that equivalent inputs
 * hash identically (used for duplicate detection).
 */
export function normalizeUrl(raw: string, selfHost: string): string {
  if (raw.length > MAX_URL_LENGTH) {
    throw new ValidationError(`URL must not exceed ${MAX_URL_LENGTH} characters`);
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new ValidationError("URLs with embedded credentials are not allowed");
  }
  if (url.host === selfHost) {
    throw new ValidationError("Shortening a link that points to this service is not allowed");
  }
  return url.href;
}

export function hashUrl(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

export function validateAlias(alias: string): string {
  if (!ALIAS_PATTERN.test(alias)) {
    throw new ValidationError("Alias must be 3-32 characters of letters, digits, hyphen or underscore");
  }
  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    throw new ValidationError(`Alias '${alias}' is reserved`);
  }
  return alias;
}
