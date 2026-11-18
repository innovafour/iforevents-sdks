import { describe, expect, it } from "vitest";
import { ATTRIBUTION_SESSION_MS, attributionFromQuery, attributionFromURL, nextAttribution, withAttribution } from "../src/index";

describe("attribution", () => {
  it("reads utm parameters, click ids and an external referring domain", () => {
    expect(attributionFromURL("https://shop.example/p?utm_source=Google&utm_medium=cpc&gclid=abc&other=1", "https://www.google.com/search")).toEqual({
      utm_source: "Google",
      utm_medium: "cpc",
      gclid: "abc",
      referring_domain: "google.com",
    });
  });
  it("ignores the site's own referrer and a URL without parameters", () => {
    expect(attributionFromURL("https://www.shop.example/a", "https://shop.example/b")).toEqual({});
    expect(attributionFromURL("https://shop.example/a")).toEqual({});
  });
  it("reads app deep links and install referrers", () => {
    expect(attributionFromURL("myapp://promo?utm_source=tiktok&utm_campaign=launch")).toEqual({ utm_source: "tiktok", utm_campaign: "launch" });
    expect(attributionFromQuery("utm_source=google-play&utm_medium=organic")).toEqual({ utm_source: "google-play", utm_medium: "organic" });
  });
  it("keeps a session's attribution for 30 minutes of inactivity and lets a new landing replace it", () => {
    const first = nextAttribution(null, { utm_source: "a" }, 0)!;
    const kept = nextAttribution(first, {}, ATTRIBUTION_SESSION_MS)!;
    expect(kept.props).toEqual({ utm_source: "a" });
    expect(nextAttribution(kept, {}, 2 * ATTRIBUTION_SESSION_MS + 1)).toBeNull();
    expect(nextAttribution(kept, { utm_source: "b" }, ATTRIBUTION_SESSION_MS + 1)!.props).toEqual({ utm_source: "b" });
    expect(nextAttribution(null, {}, 0)).toBeNull();
  });
  it("never overrides the caller's own properties", () => {
    expect(withAttribution({ utm_source: "mine", plan: "pro" }, { props: { utm_source: "a", utm_medium: "b" }, lastSeen: 0 })).toEqual({ utm_source: "mine", utm_medium: "b", plan: "pro" });
    expect(withAttribution(undefined, null)).toEqual({});
  });
});
