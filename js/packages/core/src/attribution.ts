import type { Properties } from "./types";

/**
 * Session attribution (sdks/CONTRACT.md, "Attribution"): the utm
 * parameters, ad click ids and external referring domain a visit arrived
 * with, attached as event properties to every event of that visit so the
 * api can split any report by origin ($channel, $source, $utm_campaign…).
 */

/** The utm parameters, attached under their own names. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"] as const;

/** Ad platform click ids, attached under their own names. */
export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "dclid", "msclkid", "fbclid", "ttclid", "twclid", "li_fat_id", "epik", "sccid", "rdt_cid", "yclid"] as const;

/** A session ends after this long without an event (the usual 30 minutes). */
export const ATTRIBUTION_SESSION_MS = 30 * 60_000;

/** Longest value kept per parameter. */
const MAX_VALUE = 512;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The attribution of a landing: the utm and click id parameters of `url`
 * (an absolute URL, or an app deep link such as `myapp://promo?utm_source=x`)
 * plus `referring_domain` when `referrer` is another site than `url`'s.
 * Empty when the landing carries none: a direct visit.
 */
export function attributionFromURL(url: string, referrer = ""): Properties {
  const out: Properties = {};
  let params: URLSearchParams | null = null;
  try {
    params = new URL(url).searchParams;
  } catch {
    const q = url.indexOf("?");
    if (q >= 0) {
      try {
        params = new URLSearchParams(url.slice(q + 1).split("#")[0]);
      } catch {
        params = null;
      }
    }
  }
  if (params) {
    for (const key of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
      const value = params.get(key)?.trim();
      if (value) out[key] = value.slice(0, MAX_VALUE);
    }
  }
  const refHost = referrer ? host(referrer) : "";
  if (refHost && refHost !== host(url)) out.referring_domain = refHost;
  return out;
}

/**
 * The attribution of an install or campaign referrer string, such as the
 * Google Play install referrer `utm_source=google-play&utm_medium=organic`.
 */
export function attributionFromQuery(query: string): Properties {
  return attributionFromURL(`x://x?${query.replace(/^\?/, "")}`);
}

/** True when the properties carry any attribution. */
export function hasAttribution(props: Properties): boolean {
  return Object.keys(props).length > 0;
}

/** Stored attribution of the current session. */
export type AttributionState = { props: Properties; lastSeen: number };

/**
 * Decides the session attribution after an event at `now`: a landing that
 * carries attribution starts a new one; otherwise the current one lasts
 * while events keep coming within ATTRIBUTION_SESSION_MS, and expires
 * after (the next visit is direct until it brings its own).
 */
export function nextAttribution(current: AttributionState | null, landing: Properties, now: number): AttributionState | null {
  if (hasAttribution(landing)) return { props: landing, lastSeen: now };
  if (current && now - current.lastSeen <= ATTRIBUTION_SESSION_MS) return { props: current.props, lastSeen: now };
  return null;
}

/** Adds the attribution to an event's properties; the caller's own keys win. */
export function withAttribution(properties: Properties | undefined, state: AttributionState | null): Properties {
  const props = properties ?? {};
  if (!state) return props;
  return { ...state.props, ...props };
}

export function parseAttributionState(raw: string | null): AttributionState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as AttributionState;
    if (v && typeof v.lastSeen === "number" && v.props && typeof v.props === "object") return v;
  } catch {
    /* corrupt entry: start over */
  }
  return null;
}
