/**
 * Server-side entry for route handlers, server actions and middleware:
 * a process-wide client that batches and drains on exit.
 *
 *   import { getServerIforevents } from "@iforevents/next/server";
 *   const { iforevents } = await getServerIforevents({ projectKey: process.env.IFOREVENTS_PROJECT_KEY! });
 */
import { createIforevents, type NodeIforevents, type NodeIforeventsOptions } from "@iforevents/node";

export * from "@iforevents/node";

let singleton: Promise<NodeIforevents> | null = null;

/** Creates the server client once per process (hot reload safe via `globalThis`). */
export function getServerIforevents(options: NodeIforeventsOptions): Promise<NodeIforevents> {
  const g = globalThis as { __iforeventsNext?: Promise<NodeIforevents> };
  if (!singleton) singleton = g.__iforeventsNext ?? (g.__iforeventsNext = createIforevents(options));
  return singleton;
}

/** Test hook: drop the process-wide client. */
export async function resetServerIforevents(): Promise<void> {
  const g = globalThis as { __iforeventsNext?: Promise<NodeIforevents> };
  const current = singleton ?? g.__iforeventsNext;
  singleton = null;
  delete g.__iforeventsNext;
  if (current) await (await current).shutdown();
}
