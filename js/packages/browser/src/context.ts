import type { Properties } from "@iforevents/core";

export const SDK_NAME = "@iforevents/browser";
export const SDK_VERSION = "0.1.0";

/** Coarse browser and OS names from the user agent; no fingerprinting. */
export function parseUserAgent(ua: string): { browser: string; os: string; osVersion: string } {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : "Unknown";
  let os = "Unknown";
  let osVersion = "";
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Windows NT ([\d.]+)/))) {
    os = "Windows";
    osVersion = m[1] ?? "";
  } else if ((m = ua.match(/Android ([\d.]+)/))) {
    os = "Android";
    osVersion = m[1] ?? "";
  } else if ((m = ua.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/))) {
    os = "iOS";
    osVersion = (m[1] ?? "").replace(/_/g, ".");
  } else if ((m = ua.match(/Mac OS X ([\d_.]+)/))) {
    os = "macOS";
    osVersion = (m[1] ?? "").replace(/_/g, ".");
  } else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os, osVersion };
}

/** Browser context merged into identify traits, with the Flutter key names. */
export function browserContext(extra: Properties = {}): Properties {
  if (typeof navigator === "undefined") return { sdk_name: SDK_NAME, sdk_version: SDK_VERSION, runtime: "unknown", ...extra };
  const ua = navigator.userAgent ?? "";
  const { browser, os, osVersion } = parseUserAgent(ua);
  const screenInfo = typeof screen !== "undefined" ? { screen_width: screen.width, screen_height: screen.height } : {};
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* older engines */
  }
  return {
    sdk_name: SDK_NAME,
    sdk_version: SDK_VERSION,
    runtime: "browser",
    device_platform: "web",
    device_brand: browser,
    device_model: os,
    device_os_version: osVersion,
    device_app_version: "",
    language: navigator.language ?? "",
    user_agent: ua,
    timezone,
    ...screenInfo,
    ...extra,
  };
}
