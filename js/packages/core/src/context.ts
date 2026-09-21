import type { Properties } from "./types";

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
