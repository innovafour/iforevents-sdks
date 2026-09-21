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
import { SDK_VERSION, browserContext } from "./context";

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
  onResult?: (results: IntegrationResult[]) => void;
}

/** A queued call from the async snippet: `window.iforevents.push(['track', 'name', {...}])`. */
export type QueuedCall = [method: string, ...args: unknown[]];

export interface BrowserIforevents {
  iforevents: Iforevents;
  api: IForeventsAPIIntegration | null;
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

function pageProperties(overrides: Properties): Properties {
  if (typeof window === "undefined") return { ...overrides };
  const loc = window.location;
  return { page: loc.pathname, url: loc.href, referrer: document.referrer, title: document.title, search: loc.search, ...overrides };
}

/**
 * Creates and initializes an `Iforevents` for the browser: `localStorage`
 * for the user uuid and the pending queue, a beacon flush on `pagehide`,
 * optional automatic page views on history changes.
 */
export function createBrowserIforevents(projectKey: string, options: BrowserIforeventsOptions = {}): BrowserIforevents {
  const { integrations = [], autoTrack = false, appVersion = "", context = {}, disableApi = false, onResult, ...apiConfig } = options;
  const storage = apiConfig.storage ?? pickStorage();
  const api = disableApi ? null : new IForeventsAPIIntegration({ persistQueue: true, ...apiConfig, projectKey, storage });
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
  const client: BrowserIforevents = {
    iforevents,
    api,
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
      const opts: PageOptions = { toRoute: String(merged.page ?? ""), ...pageOptions };
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
  }
  return client;
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
