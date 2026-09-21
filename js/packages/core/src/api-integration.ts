import { IForeventsAPIError, IForeventsQuotaExceededError, classifyResponse } from "./errors";
import { Integration, type IntegrationHooks } from "./integration";
import { MemoryStorage, type Storage } from "./storage";
import type { EventType, IdentifyEvent, Logger, PageEvent, Properties, TrackEvent } from "./types";

/**
 * Configuration of the first-party API integration.
 *
 * Only `projectKey` is required. It is a public write key: it grants event
 * ingestion and nothing else, so shipping it in a browser bundle or an app
 * binary is safe. There is deliberately no project secret here.
 */
export interface IForeventsAPIConfig {
  /** Public project write key (required). */
  projectKey: string;
  /** API origin. Default `https://api.iforevents.com`. */
  baseUrl?: string;
  /** Events to accumulate before sending (1..500). 1 disables batching. Default 10. */
  batchSize?: number;
  /** Milliseconds a partial batch waits before it is sent. Default 5000. */
  flushInterval?: number;
  /** Per-request timeout in milliseconds. Default 10000. */
  timeout?: number;
  /** Retries for transient failures (network, 5xx, short rate limits). Default 3. */
  maxRetries?: number;
  /** Base delay between retries in milliseconds, multiplied by the attempt number. Default 1000. */
  retryDelay?: number;
  /** Put events that failed with a transient error back in the queue. Default true. */
  requeueFailedEvents?: boolean;
  /** Log requests and failures. Default false. */
  debug?: boolean;
  /** Reject `identify`/`flush` instead of only logging when a request fails. Default false. */
  throwOnError?: boolean;
  /** Called once when the api starts refusing events with `quota_exceeded`, and again after a later success followed by a new refusal. */
  onQuotaExceeded?: (error: IForeventsQuotaExceededError) => void;
  /** Called for every failed request after retries are exhausted. */
  onError?: (error: IForeventsAPIError) => void;
  /** Where the user uuid and (optionally) the pending queue live. Default in-memory. */
  storage?: Storage;
  /** Persist the pending queue in `storage` so unsent events survive a restart. Default false. */
  persistQueue?: boolean;
  /** Most events kept in the persisted queue. Default 1000. */
  maxQueueSize?: number;
  /** Custom fetch, for tests or runtimes that polyfill it. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Value of the `User-Agent` header where the runtime allows setting it (servers). */
  userAgent?: string;
  logger?: Logger;
}

/** One event as queued and sent to `/v1/events/batch`. */
export interface QueuedEvent {
  name: string;
  type: EventType;
  properties: Properties;
  created_at: string;
}

export interface QueueStatus {
  queuedEvents: number;
  batchSize: number;
  isInitialized: boolean;
  isIdentified: boolean;
  userId: string | null;
}

const USER_KEY = "iforevents_user_id";
const IDENTIFIED_KEY = "iforevents_user_identified";
const QUEUE_KEY = "iforevents_queue";
const MAX_BATCH = 500;
const DEFAULT_BASE_URL = "https://api.iforevents.com";

type Resolved = Required<Pick<IForeventsAPIConfig, "baseUrl" | "batchSize" | "flushInterval" | "timeout" | "maxRetries" | "retryDelay" | "requeueFailedEvents" | "debug" | "throwOnError" | "persistQueue" | "maxQueueSize">>;

/**
 * Talks to the IForevents ingest API: identify, single or batched track,
 * page views, persisted user uuid, retries with `Retry-After`, and typed
 * errors. Mirrors `IForeventsAPIIntegration` of the Flutter package.
 */
export class IForeventsAPIIntegration extends Integration {
  readonly config: IForeventsAPIConfig & Resolved;
  private readonly storage: Storage;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger | null;

  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> = Promise.resolve();
  private userId: string | null = null;
  private initialized = false;
  private identified = false;
  private quotaExceeded = false;

  constructor(config: IForeventsAPIConfig, hooks: IntegrationHooks = {}) {
    super(hooks, "IForeventsAPIIntegration");
    if (!config || typeof config.projectKey !== "string" || config.projectKey.trim() === "") {
      throw new Error("[iforevents] IForeventsAPIIntegration needs a projectKey");
    }
    if ("projectSecret" in (config as object)) {
      throw new Error("[iforevents] the project secret never belongs in an SDK; pass the project key only");
    }
    const batchSize = Math.max(1, Math.min(MAX_BATCH, Math.floor(config.batchSize ?? 10)));
    this.config = {
      ...config,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      batchSize,
      flushInterval: config.flushInterval ?? 5000,
      timeout: config.timeout ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      requeueFailedEvents: config.requeueFailedEvents ?? true,
      debug: config.debug ?? false,
      throwOnError: config.throwOnError ?? false,
      persistQueue: config.persistQueue ?? false,
      maxQueueSize: config.maxQueueSize ?? 1000,
    };
    this.storage = config.storage ?? new MemoryStorage();
    const f = config.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof f !== "function") throw new Error("[iforevents] no fetch available; pass config.fetch");
    // window.fetch throws "Illegal invocation" unless called on the window.
    this.fetchImpl = f.bind(globalThis);
    this.logger = this.config.debug ? (config.logger ?? console) : null;
  }

  // --- state -----------------------------------------------------------------

  get isInitialized(): boolean {
    return this.initialized;
  }
  get isIdentified(): boolean {
    return this.identified;
  }
  /**
   * The id every request carries in `X-User-Id`: a generated `anon_...` id
   * kept per visitor, or the customId of the last identify.
   */
  get currentUserId(): string | null {
    return this.userId;
  }
  get queuedEventsCount(): number {
    return this.queue.length;
  }
  /** True after a `quota_exceeded` answer until the next accepted request. */
  get isQuotaExceeded(): boolean {
    return this.quotaExceeded;
  }
  getQueueStatus(): QueueStatus {
    return { queuedEvents: this.queue.length, batchSize: this.config.batchSize, isInitialized: this.initialized, isIdentified: this.identified, userId: this.userId };
  }

  // --- Integration ------------------------------------------------------------

  override async init(): Promise<void> {
    await super.init();
    const stored = await this.storage.get(USER_KEY);
    if (stored) {
      this.userId = stored;
      this.identified = (await this.storage.get(IDENTIFIED_KEY)) === "true";
    } else {
      // A fresh visitor: attribute everything to an anonymous id we own, so the
      // api never has to fingerprint the address (which merges users behind a NAT).
      await this.setUser(anonymousId(), false);
    }
    if (this.config.persistQueue) {
      const raw = await this.storage.get(QUEUE_KEY);
      if (raw) {
        try {
          const events = JSON.parse(raw) as QueuedEvent[];
          if (Array.isArray(events) && events.length > 0) {
            this.queue = [...events, ...this.queue].slice(-this.config.maxQueueSize);
            this.schedule();
          }
        } catch {
          await this.storage.remove(QUEUE_KEY);
        }
      }
    }
    this.initialized = true;
    this.logger?.debug("[iforevents] api integration ready", { baseUrl: this.config.baseUrl, batchSize: this.config.batchSize });
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    const { email, name, phone_number, ...properties } = event.traits;
    const body: Record<string, unknown> = { custom_id: event.customId, properties };
    if (typeof email === "string" && email) body.email = email;
    if (typeof name === "string" && name) body.name = name;
    if (typeof phone_number === "string" && phone_number) body.phone_number = phone_number;
    // Attribute from now on, even if the profile request itself fails: the
    // api creates the profile on the first event it sees for this id.
    await this.setUser(event.customId, true);
    try {
      await this.request("/v1/events/identify", body);
    } catch (error) {
      this.report(error);
      if (this.config.throwOnError) throw error;
    }
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    const queued: QueuedEvent = { name: event.name, type: event.type, properties: event.properties, created_at: event.timestamp.toISOString() };
    if (this.config.batchSize <= 1) {
      try {
        await this.request("/v1/events/track", { event_name: queued.name, event_type: queued.type, properties: queued.properties });
      } catch (error) {
        this.report(error);
        if (this.config.throwOnError) throw error;
      }
      return;
    }
    this.queue.push(queued);
    if (this.queue.length > this.config.maxQueueSize) this.queue.splice(0, this.queue.length - this.config.maxQueueSize);
    await this.persist();
    if (this.queue.length >= this.config.batchSize) void this.flush();
    else this.schedule();
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    const properties: Properties = { ...event.properties };
    if (event.navigationType !== undefined) properties.navigation_type = event.navigationType;
    if (event.toRoute !== undefined) properties.to_route = event.toRoute;
    if (event.previousRoute !== undefined) properties.previous_route = event.previousRoute;
    await this.track({ name: event.name || "page_view", type: "page_view", properties, timestamp: event.timestamp });
  }

  override async reset(): Promise<void> {
    await super.reset();
    await this.flush();
    // Forget the person; the next events belong to a fresh anonymous id.
    await this.setUser(anonymousId(), false);
  }

  /** Sends the whole queue now, 500 events per request. Resolves when done. */
  override async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A previous rejected drain (throwOnError) must not poison later flushes.
    const run = this.inflight.catch(() => undefined).then(() => this.drain(options.keepalive ?? false));
    this.inflight = run.catch(() => undefined);
    await run;
  }

  override async shutdown(): Promise<void> {
    await this.flush();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // --- internals ----------------------------------------------------------------

  private async drain(keepalive: boolean): Promise<void> {
    while (this.queue.length > 0) {
      const events = this.queue.splice(0, MAX_BATCH);
      try {
        await this.request("/v1/events/batch", { events }, keepalive);
        await this.persist();
      } catch (error) {
        const apiError = error instanceof IForeventsAPIError ? error : new IForeventsAPIError(String(error), { cause: error });
        if (apiError.retryable && this.config.requeueFailedEvents) {
          // Transient: keep these events at the front for the next flush.
          this.queue.unshift(...events);
          this.schedule();
        } else if (!apiError.retryable) {
          // A refused key or an exhausted quota would fail the same way forever: drop everything.
          this.queue = [];
        }
        await this.persist();
        this.report(apiError);
        if (this.config.throwOnError) throw apiError;
        return;
      }
    }
  }

  private schedule(): void {
    if (this.timer || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.config.flushInterval);
    // Never keep a server process alive just for a pending batch.
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async setUser(id: string, identified: boolean): Promise<void> {
    this.userId = id;
    this.identified = identified;
    await this.storage.set(USER_KEY, id);
    await this.storage.set(IDENTIFIED_KEY, identified ? "true" : "false");
  }

  private async persist(): Promise<void> {
    if (!this.config.persistQueue) return;
    if (this.queue.length === 0) await this.storage.remove(QUEUE_KEY);
    else await this.storage.set(QUEUE_KEY, JSON.stringify(this.queue));
  }

  private report(error: unknown): void {
    this.logger?.warn("[iforevents] request failed", error);
    if (error instanceof IForeventsAPIError) this.config.onError?.(error);
  }

  private noteOutcome(error: IForeventsAPIError | null): void {
    if (error instanceof IForeventsQuotaExceededError) {
      if (!this.quotaExceeded) {
        this.quotaExceeded = true;
        this.config.onQuotaExceeded?.(error);
      }
    } else if (error === null) {
      this.quotaExceeded = false;
    }
  }

  /** POSTs JSON with retries; resolves with the decoded body (or null). */
  private async request(path: string, body: unknown, keepalive = false): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Project-Key": this.config.projectKey };
    if (this.userId) headers["X-User-Id"] = this.userId;
    // Only headers on the api's CORS allowlist (Content-Type, X-Project-Key,
    // X-User-Id) may be sent from browsers; the sdk name and version
    // travel inside the context properties instead of a custom header.
    if (this.config.userAgent) headers["User-Agent"] = this.config.userAgent;
    const payload = JSON.stringify(body);
    const url = `${this.config.baseUrl}${path}`;

    for (let attempt = 0; ; attempt++) {
      let error: IForeventsAPIError;
      try {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), this.config.timeout) : null;
        let res: Response;
        try {
          res = await this.fetchImpl(url, { method: "POST", headers, body: payload, keepalive, signal: controller?.signal ?? null });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
        const text = await res.text();
        const json = parseJSON(text);
        this.logger?.debug(`[iforevents] POST ${path} -> ${res.status}`);
        if (res.ok) {
          this.noteOutcome(null);
          return json;
        }
        error = classifyResponse(res.status, json, res.headers.get("retry-after"));
      } catch (cause) {
        error = new IForeventsAPIError(cause instanceof Error ? cause.message : String(cause), { cause });
      }
      if (!error.retryable || attempt >= this.config.maxRetries) {
        this.noteOutcome(error);
        throw error;
      }
      const retryAfter = "retryAfterMs" in error ? (error as { retryAfterMs?: number }).retryAfterMs : undefined;
      const delay = retryAfter && retryAfter > 0 ? retryAfter : this.config.retryDelay * (attempt + 1);
      this.logger?.debug(`[iforevents] retrying ${path} in ${delay}ms (${attempt + 1}/${this.config.maxRetries})`);
      await sleep(delay);
    }
  }
}

/** A fresh anonymous id, unrelated to anything the server derives: anon_<uuid4 without dashes>. */
export function anonymousId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `anon_${hex}`;
}

function parseJSON(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
