export type ErrorCode =
  | "VALIDATION_FAILED"
  | "LINK_NOT_FOUND"
  | "LINK_EXPIRED"
  | "ALIAS_TAKEN"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
  }
}

export class LinkNotFoundError extends DomainError {
  constructor(code: string) {
    super("LINK_NOT_FOUND", `Link '${code}' does not exist`);
  }
}

export class LinkExpiredError extends DomainError {
  constructor(code: string) {
    super("LINK_EXPIRED", `Link '${code}' has expired`);
  }
}

export class AliasTakenError extends DomainError {
  constructor(alias: string) {
    super("ALIAS_TAKEN", `Alias '${alias}' is already in use`);
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED", "Too many requests");
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super("UNAUTHORIZED", "Missing or invalid API key");
  }
}
