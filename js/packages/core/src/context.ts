import type { EventContext, Properties } from "./types";

export const SDK_NAME = "@iforevents/core";
export const SDK_VERSION = "0.1.0";

/** Runtime label for server context. */
export function detectRuntime(): string {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.Deno === "object" && g.Deno !== null) return "deno";
  if (typeof g.Bun === "object" && g.Bun !== null) return "bun";
  const proc = g.process as { versions?: { node?: string } } | undefined;
  if (proc?.versions?.node) return `node/${proc.versions.node}`;
  if (typeof g.navigator === "object" && g.navigator !== null && "userAgent" in (g.navigator as object)) return "browser";
  return "unknown";
}

/** Default context: sdk name/version and runtime. Platform packages extend it. */
export const defaultContext = (): Properties => ({ sdk_name: SDK_NAME, sdk_version: SDK_VERSION, runtime: detectRuntime() });

/** Default request context: the library alone. Platform packages add the device, OS and locale. */
export const defaultEventContext = (): EventContext => ({ library: { name: SDK_NAME, version: SDK_VERSION } });

/** The campaign of a page from its `utm_*` query parameters; undefined when it has none. */
export function campaignFromSearch(search: string): EventContext["campaign"] {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const campaign: NonNullable<EventContext["campaign"]> = {};
  const fields = { utm_source: "source", utm_medium: "medium", utm_campaign: "name", utm_term: "term", utm_content: "content" } as const;
  for (const [param, field] of Object.entries(fields)) {
    const value = params.get(param);
    if (value) campaign[field] = value;
  }
  return Object.keys(campaign).length > 0 ? campaign : undefined;
}
