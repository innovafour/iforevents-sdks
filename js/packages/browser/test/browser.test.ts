import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, sleep } from "../../core/test/mock-server";
import { Iforevents, browserContext, createBrowserIforevents, parseUserAgent } from "../src/index";

const api = new MockApi();
beforeAll(() => api.start());
afterAll(() => api.stop());
beforeEach(() => {
  api.reset();
  localStorage.clear();
});
afterEach(async () => {
  await Iforevents._resetForTests();
});

describe("@iforevents/browser", () => {
  it("parses coarse browser and os from the user agent", () => {
    const chromeMac = parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
    expect(chromeMac).toEqual({ browser: "Chrome", os: "macOS", osVersion: "10.15.7" });
    const safariIos = parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    expect(safariIos).toEqual({ browser: "Safari", os: "iOS", osVersion: "17.5" });
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0").browser).toBe("Firefox");
  });

  it("collects web context with the contract key names", () => {
    const ctx = browserContext({ device_app_version: "2.1.0" });
    expect(ctx.device_platform).toBe("web");
    expect(ctx.sdk_name).toBe("@iforevents/browser");
    expect(ctx.device_app_version).toBe("2.1.0");
    expect(typeof ctx.user_agent).toBe("string");
  });

  it("page() adds path, url, referrer and title and sends a page_view", async () => {
    const client = createBrowserIforevents("pk_test", { baseUrl: api.baseUrl, batchSize: 1 });
    await client.page({ section: "hero" });
    const [req] = api.byPath("/v1/events/track");
    expect(req?.body.event_type).toBe("page_view");
    const props = req?.body.properties as Record<string, unknown>;
    expect(props.page).toBe(window.location.pathname);
    expect(props.url).toBe(window.location.href);
    expect(props.section).toBe("hero");
    expect(props.to_route).toBe(window.location.pathname);
    await client.shutdown();
  });

  it("persists the user uuid and the queue in localStorage", async () => {
    const client = createBrowserIforevents("pk_test", { baseUrl: api.baseUrl, batchSize: 100, flushInterval: 10_000 });
    await client.identify("web_user", { email: "w@e.b" });
    expect(localStorage.getItem("iforevents_user_id")).toBe("web_user");
    await client.track("queued_only");
    expect(localStorage.getItem("iforevents_queue")).toContain("queued_only");
    await client.flush();
    expect(localStorage.getItem("iforevents_queue")).toBeNull();
    await client.reset();
    expect(localStorage.getItem("iforevents_user_id")).toMatch(/^anon_[0-9a-f]{32}$/);
    expect(localStorage.getItem("iforevents_user_identified")).toBe("false");
    await client.shutdown();
  });

  it("autoTrack fires a page view on load and on pushState/popstate", async () => {
    const client = createBrowserIforevents("pk_test", { baseUrl: api.baseUrl, batchSize: 1, autoTrack: true });
    await sleep(30);
    history.pushState({}, "", "/pricing");
    await sleep(30);
    history.back();
    await sleep(60);
    const views = api.byPath("/v1/events/track").map((r) => r.body.properties as Record<string, unknown>);
    expect(views.length).toBeGreaterThanOrEqual(2);
    expect(views[0]?.navigation_type).toBe("load");
    expect(views[1]?.navigation_type).toBe("pushState");
    expect(views[1]?.to_route).toBe("/pricing");
    expect(views[1]?.previous_route).toBe("/");
    await client.shutdown();
  });

  it("static facade replays the window.iforevents queue in order", async () => {
    (window as unknown as { iforevents: unknown[] }).iforevents = [
      ["identify", "queued_user", { plan: "pro" }],
      ["track", "queued_event", { a: 1 }],
    ];
    Iforevents.init("pk_test", { baseUrl: api.baseUrl, batchSize: 1 });
    await sleep(80);
    (window as unknown as { iforevents: { push(c: unknown[]): void } }).iforevents.push(["track", "live_event"]);
    await sleep(40);
    expect(api.byPath("/v1/events/identify")[0]?.body.custom_id).toBe("queued_user");
    const names = api.byPath("/v1/events/track").map((r) => r.body.event_name);
    expect(names).toEqual(["queued_event", "live_event"]);
    expect(api.byPath("/v1/events/track")[0]?.headers["x-user-id"]).toBe("queued_user");
  });

  it("static facade throws before init and is idempotent after", () => {
    expect(() => Iforevents.track("x")).toThrow(/init/);
    const a = Iforevents.init("pk_test", { baseUrl: api.baseUrl });
    const b = Iforevents.init("pk_other");
    expect(a).toBe(b);
  });
});
