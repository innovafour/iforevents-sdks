/** Loads an optional peer package at runtime; the message names what to install. */
export async function loadVendor<T>(specifier: string, pick?: (mod: Record<string, unknown>) => T): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`[iforevents] ${specifier} is not installed; run: npm install ${specifier}`, { cause });
  }
  return pick ? pick(mod) : ((mod.default ?? mod) as T);
}

/** Vendors reject nulls and nested objects; keep scalars, stringify the rest. */
export function scalarize(properties: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
  }
  return out;
}
