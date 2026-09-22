import type { Properties } from "./types";

/**
 * Flattens nested plain objects with `_`, as the Flutter package does:
 * `{ a: { b: 1 } }` becomes `{ a_b: 1 }`. Arrays, dates and class instances
 * are kept as values.
 */
export function flatten(input: Properties, prefix = ""): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(input)) {
    const name = prefix ? `${prefix}_${key}` : key;
    if (isPlainObject(value)) Object.assign(out, flatten(value as Properties, name));
    else out[name] = value;
  }
  return out;
}

export function isPlainObject(value: unknown): value is Properties {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
