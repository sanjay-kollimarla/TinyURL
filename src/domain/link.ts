export interface Link {
  readonly code: string;
  readonly longUrl: string;
  readonly urlHash: string;
  /** True when the code was chosen by the caller rather than generated. */
  readonly custom: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly clickCount: number;
  readonly lastClickedAt: Date | null;
}

/** The minimal projection needed to serve a redirect; this is what gets cached. */
export interface RedirectTarget {
  readonly longUrl: string;
  /** Epoch millis, or null for links that never expire. */
  readonly expiresAt: number | null;
}

export function isExpiredAt(expiresAt: number | null, nowMs: number): boolean {
  return expiresAt !== null && expiresAt <= nowMs;
}

export function toRedirectTarget(link: Link): RedirectTarget {
  return { longUrl: link.longUrl, expiresAt: link.expiresAt?.getTime() ?? null };
}
