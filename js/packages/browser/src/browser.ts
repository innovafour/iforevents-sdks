import {
  IForeventsAPIIntegration,
  Iforevents,
  MemoryStorage,
  WebStorage,
  type IForeventsAPIConfig,
  type Integration,
  type IntegrationResult,
  type PageOptions,
  type Properties,
  type Storage,
} from "@iforevents/core";
import { SDK_VERSION, browserContext, browserEventContext } from "./context";
import { HeatmapRecorder, type HeatmapOptions, type HeatmapPayload } from "./heatmap";

export interface BrowserIforeventsOptions extends Omit<IForeventsAPIConfig, "projectKey" | "userAgent" | "fetch"> {
  /** Extra integrations (Mixpanel, GA4, ...) that receive every call. */
  integrations?: Integration[];
  /** Track the first page view and every history change. Default false. */
  autoTrack?: boolean;
  /** Version of your app, sent as `device_app_version`. */
  appVersion?: string;
  /** Extra context merged into identify traits. */
  context?: Properties;
  /** Skip the IForevents API integration (adapters only). Default false. */
  disableApi?: boolean;
  /**
   * Record heatmaps: clicks, rage and dead clicks, mouse movement,
   * hesitation, exit intent, copied text, scroll depth and attention per
   * page (sent aggregated to /v1/events/heatmap). Default true; `false`
   * turns it off, an object tunes it.
   */
  heatmaps?: boolean | HeatmapOptions;
  onResult?: (results: IntegrationResult[]) => void;
}

/** A queued call from the async snippet: `window.iforevents.push(['track', 'name', {...}])`. */
export type QueuedCall = [method: string, ...args: unknown[]];

export interface BrowserIforevents {
  iforevents: Iforevents;
  api: IForeventsAPIIntegration | null;
  /** The heatmap recorder, or null when heatmaps are off. */
  heatmaps: HeatmapRecorder | null;
  track(name: string, properties?: Properties): Promise<IntegrationResult[]>;
  /** `page()`, `page(props)` or `page(name, props)`; path, url, referrer and title are added unless overridden. */
  page(nameOrProperties?: string | Properties, properties?: Properties, options?: PageOptions): Promise<IntegrationResult[]>;
  identify(customId: string, traits?: Properties): Promise<IntegrationResult[]>;
  reset(): Promise<IntegrationResult[]>;
  flush(): Promise<IntegrationResult[]>;
  shutdown(): Promise<IntegrationResult[]>;
}

function pickStorage(): Storage {
  try {
    if (typeof localStorage !== "undefined") {
      const probe = "__iforevents_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return new WebStorage(localStorage);
    }
  } catch {
    /* private mode or disabled storage */
  }
  return new MemoryStorage();
}

// The api derives the path (page) from the url and keeps the query as part of
// it, so neither is sent a second time.
function pageProperties(overrides: Properties): Properties {
  if (typeof window === "undefined") return { ...overrides };
  const loc = window.location;
  return { url: loc.href, referrer: document.referrer, title: document.title, ...overrides };
}

/**
 * Creates and initializes an `Iforevents` for the browser: `localStorage`
 * for the user uuid and the pending queue, a beacon flush on `pagehide`,
 * optional automatic page views on history changes.
 */
export function createBrowserIforevents(projectKey: string, options: BrowserIforeventsOptions = {}): BrowserIforevents {
  const { integrations = [], autoTrack = false, appVersion = "", context = {}, disableApi = false, heatmaps = true, onResult, ...apiConfig } = options;
  const storage = apiConfig.storage ?? pickStorage();
  const api = disableApi ? null : new IForeventsAPIIntegration({ persistQueue: true, eventContext: () => browserEventContext(appVersion), ...apiConfig, projectKey, storage });
  const iforevents = new Iforevents({
    integrations: api ? [api, ...integrations] : integrations,
    context: () => browserContext({ device_app_version: appVersion, ...context }),
    debug: apiConfig.debug,
    logger: apiConfig.logger,
    onResult,
  });
  const ready = iforevents.init();

  let lastPath = typeof window !== "undefined" ? window.location.pathname : "";
  // Events fired right after identify must carry its uuid: wait for it.
  let identifying: Promise<unknown> = Promise.resolve();
  const recorder = api && heatmaps !== false && typeof window !== "undefined" ? new HeatmapRecorder(heatmapSender(api, apiConfig), heatmaps === true ? {} : heatmaps) : null;
  const client: BrowserIforevents = {
    iforevents,
    api,
    heatmaps: recorder,
    track: async (name, properties) => {
      await ready;
      await identifying;
      return iforevents.track(name, properties);
    },
    page: async (nameOrProperties, properties, pageOptions = {}) => {
      await ready;
      await identifying;
      const name = typeof nameOrProperties === "string" ? nameOrProperties : undefined;
      const props = typeof nameOrProperties === "string" ? (properties ?? {}) : (nameOrProperties ?? {});
      const merged = pageProperties(props);
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      const opts: PageOptions = { toRoute: String(props.page ?? path), ...pageOptions };
      return iforevents.page(name ?? "page_view", merged, opts);
    },
    identify: async (customId, traits) => {
      await ready;
      const run = iforevents.identify(customId, traits);
      identifying = run.catch(() => undefined);
      return run;
    },
    reset: async () => {
      await ready;
      return iforevents.reset();
    },
    flush: async () => {
      await ready;
      return iforevents.flush();
    },
    shutdown: async () => {
      await ready;
      await recorder?.stop();
      return iforevents.shutdown();
    },
  };

  if (typeof window !== "undefined") {
    const beacon = (): void => {
      // keepalive lets the request outlive the page.
      void api?.flush({ keepalive: true });
    };
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") beacon();
    });
    if (autoTrack) setupAutoTracking(client, () => lastPath, (p) => (lastPath = p));
    if (recorder) void ready.then(() => recorder.start());
  }
  return client;
}

// Heatmap batches go straight to the api with the same key and user id as
// the events; they are not queued with them (a heatmap is a sample: what
// fails to send is dropped).
function heatmapSender(api: IForeventsAPIIntegration, config: Omit<IForeventsAPIConfig, "projectKey">): (payload: HeatmapPayload, keepalive: boolean) => Promise<void> {
  const fetchImpl = (config.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch)?.bind(globalThis);
  return async (payload, keepalive) => {
    if (!fetchImpl) return;
    const userId = api.currentUserId;
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Project-Key": api.config.projectKey };
    if (userId) headers["X-User-Id"] = userId;
    const body = JSON.stringify(payload);
    // keepalive bodies are capped at 64 KB by browsers.
    const res = await fetchImpl(api.config.baseUrl + "/v1/events/heatmap", { method: "POST", headers, body, keepalive: keepalive && body.length < 60_000, credentials: "omit" });
    if (!res.ok && config.debug) (config.logger ?? console).warn("[iforevents] heatmap batch answered", res.status);
  };
}

function setupAutoTracking(client: BrowserIforevents, getLast: () => string, setLast: (p: string) => void): void {
  const fire = (navigationType: string): void => {
    const previousRoute = getLast();
    const toRoute = window.location.pathname;
    setLast(toRoute);
    void client.page(undefined, {}, { navigationType, previousRoute, toRoute });
  };
  const history = window.history;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      fire(method);
      return result;
    } as History["pushState"];
  }
  window.addEventListener("popstate", () => fire("popstate"));
  fire("load");
}

export { SDK_VERSION };
export { HeatmapRecorder, isHeatmapPreview, selectorOf, HEATMAP_PREVIEW_NAME, type HeatmapOptions, type HeatmapPayload, type HeatmapItem } from "./heatmap";
