/**
 * Errors raised by the API integration. Every api failure body is
 * `{"error": <code or message>, "message"?: <prose>}`; the ones an app can act
 * on are mapped to the classes below. `AuthError` and `QuotaExceededError`
 * are permanent: the affected events are dropped, not re-queued.
 */
export class IForeventsAPIError extends Error {
  readonly status?: number;
  /** Stable machine-readable code from the `error` field, when the api set one. */
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: { status?: number; code?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "IForeventsAPIError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  /** Transient failures are retried and their events kept. */
  get retryable(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/** Project key unknown, rotated or project disabled (401/403). */
export class IForeventsAuthError extends IForeventsAPIError {
  constructor(message: string, options: { status?: number; code?: string; details?: Record<string, unknown> } = {}) {
    super(message, options);
    this.name = "IForeventsAuthError";
  }
  override get retryable(): boolean {
    return false;
  }
}

/** Monthly plan quota exhausted (429 `quota_exceeded`). Holds until the next month or a plan change. */
export class IForeventsQuotaExceededError extends IForeventsAPIError {
  readonly limit?: number;
  readonly used?: number;
  readonly organizationUuid?: string;

  constructor(message: string, options: { details?: Record<string, unknown>; limit?: number; used?: number; organizationUuid?: string } = {}) {
    super(message, { status: 429, code: "quota_exceeded", details: options.details });
    this.name = "IForeventsQuotaExceededError";
    this.limit = options.limit;
    this.used = options.used;
    this.organizationUuid = options.organizationUuid;
  }
  override get retryable(): boolean {
    return false;
  }
}

/** Too many requests in a short window (429 without a quota code). Retried after `retryAfterMs`. */
export class IForeventsRateLimitedError extends IForeventsAPIError {
  readonly retryAfterMs?: number;

  constructor(message: string, options: { code?: string; details?: Record<string, unknown>; retryAfterMs?: number } = {}) {
    super(message, { status: 429, code: options.code, details: options.details });
    this.name = "IForeventsRateLimitedError";
    this.retryAfterMs = options.retryAfterMs;
  }
  override get retryable(): boolean {
    return true;
  }
}

/** Builds the typed error for an HTTP answer. */
export function classifyResponse(status: number, body: unknown, retryAfterHeader: string | null): IForeventsAPIError {
  const details = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  const code = typeof details?.error === "string" ? (details.error as string) : undefined;
  const message = String(details?.message ?? code ?? `request failed with status ${status}`);

  if (status === 429 && code === "quota_exceeded") {
    return new IForeventsQuotaExceededError(message, {
      details,
      limit: asNumber(details?.limit),
      used: asNumber(details?.used),
      organizationUuid: typeof details?.org_uuid === "string" ? (details.org_uuid as string) : undefined,
    });
  }
  if (status === 429) {
    const headerSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
    const bodySeconds = asNumber(details?.retry_after_seconds);
    const seconds = Number.isFinite(headerSeconds) ? headerSeconds : bodySeconds;
    return new IForeventsRateLimitedError(message, { code, details, retryAfterMs: seconds !== undefined ? seconds * 1000 : undefined });
  }
  if (status === 401 || status === 403) return new IForeventsAuthError(message, { status, code, details });
  return new IForeventsAPIError(message, { status, code, details });
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
