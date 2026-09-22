import { createBrowserIforevents, type BrowserIforevents, type BrowserIforeventsOptions } from "@iforevents/browser";
import type { IntegrationResult, PageOptions, Properties } from "@iforevents/core";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

export * from "@iforevents/core";
export { createBrowserIforevents, browserContext, type BrowserIforevents, type BrowserIforeventsOptions } from "@iforevents/browser";

/** What the hooks need from a client: the browser client or anything with the same four calls. */
export interface AnalyticsClient {
  track(name: string, properties?: Properties): Promise<IntegrationResult[]>;
  page(nameOrProperties?: string | Properties, properties?: Properties, options?: PageOptions): Promise<IntegrationResult[]>;
  identify(customId: string, traits?: Properties): Promise<IntegrationResult[]>;
  reset(): Promise<IntegrationResult[]>;
}

const IforeventsContext = createContext<AnalyticsClient | null>(null);

export interface IforeventsProviderProps {
  /** Project key: the provider creates a browser client once. */
  projectKey?: string;
  /** Options for that client (baseUrl, batchSize, integrations, autoTrack, ...). */
  options?: BrowserIforeventsOptions;
  /** Or bring your own client. */
  client?: AnalyticsClient;
  children?: ReactNode;
}

/** Makes an IForevents client available to the hooks below. */
export function IforeventsProvider({ projectKey, options, client, children }: IforeventsProviderProps) {
  const created = useRef<BrowserIforevents | null>(null);
  const value = useMemo<AnalyticsClient>(() => {
    if (client) return client;
    if (!projectKey) throw new Error("[iforevents] IforeventsProvider needs a projectKey or a client");
    if (!created.current) created.current = createBrowserIforevents(projectKey, options);
    return created.current;
    // options are read once; changing the key after mount is not supported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectKey]);
  useEffect(() => {
    return () => {
      void created.current?.shutdown();
      created.current = null;
    };
  }, []);
  return <IforeventsContext.Provider value={value}>{children}</IforeventsContext.Provider>;
}

/** The client from the nearest provider. */
export function useIforevents(): AnalyticsClient {
  const client = useContext(IforeventsContext);
  if (!client) throw new Error("[iforevents] useIforevents must be used inside <IforeventsProvider>");
  return client;
}

/** A stable `track(name, properties)` function. */
export function useTrack(): AnalyticsClient["track"] {
  const client = useIforevents();
  return useMemo(() => client.track.bind(client), [client]);
}

/** A stable `identify(customId, traits)` function. */
export function useIdentify(): AnalyticsClient["identify"] {
  const client = useIforevents();
  return useMemo(() => client.identify.bind(client), [client]);
}

/**
 * Sends a page view whenever `path` changes (pass `useLocation().pathname`
 * from react-router, or leave it out to fire once on mount).
 */
export function usePageView(path?: string, properties?: Properties): void {
  const client = useIforevents();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const toRoute = path ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
    void client.page(toRoute, properties ?? {}, { navigationType: previous.current === undefined ? "load" : "route", previousRoute: previous.current, toRoute });
    previous.current = toRoute;
    // properties are intentionally not a dependency: a new object each render must not re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, path]);
}
