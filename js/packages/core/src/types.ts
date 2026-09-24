/** Free-form event or trait properties. Nested objects are flattened with `_`. */
export type Properties = Record<string, unknown>;

/** Event types the api distinguishes. Page/screen views are `page_view`. */
export type EventType = "track" | "page_view";

/** A user identification: the app's own id plus traits. */
export interface IdentifyEvent {
  customId: string;
  /** Traits with the context already merged in and nested maps flattened. */
  traits: Properties;
}

/** A tracked event, ready for every integration. */
export interface TrackEvent {
  name: string;
  type: EventType;
  properties: Properties;
  /** When the event happened (set at enqueue time, sent as `created_at`). */
  timestamp: Date;
}

/** A page (web) or screen (mobile) view. */
export interface PageEvent {
  /** Route or screen name; `page_view` when unknown. */
  name: string;
  properties: Properties;
  navigationType?: string;
  toRoute?: string;
  previousRoute?: string;
  timestamp: Date;
}

/** Outcome of one integration call; the facade never throws for these. */
export interface IntegrationResult {
  integration: string;
  success: boolean;
  error?: unknown;
  timestamp: Date;
}

/** Minimal logger; `console` satisfies it. */
export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Collects platform context merged into identify traits. */
export type ContextProvider = () => Properties | Promise<Properties>;

/**
 * The device and app a request comes from, in the shape of schema 2 of the
 * IForevents events bus (sdks/CONTRACT.md section 3.1). Sent with every
 * ingest request; every field is optional.
 */
export interface EventContext {
  library?: { name: string; version: string };
  /** BCP 47 language tag, for example `es-CO`. */
  locale?: string;
  /** IANA time zone, for example `America/Bogota`. */
  timezone?: string;
  /** From the page's `utm_*` parameters. */
  campaign?: { source?: string; medium?: string; name?: string; term?: string; content?: string };
  /** `type` is `web`, `ios`, `android`, `desktop` or `server`. */
  device?: { type?: string; manufacturer?: string; model?: string; id?: string };
  os?: { name?: string; version?: string };
  app?: { name?: string; version?: string; build?: string };
  network?: { carrier?: string; wifi?: boolean; cellular?: boolean; bluetooth?: boolean };
}

/** Collects the `EventContext` sent with every request. */
export type EventContextProvider = () => EventContext | Promise<EventContext>;
