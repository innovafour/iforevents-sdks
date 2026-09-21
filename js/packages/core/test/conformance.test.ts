/**
 * Conformance suite for sdks/CONTRACT.md section 8. Each `it` names the
 * checklist item it proves.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IForeventsAPIIntegration,
  IForeventsAuthError,
  IForeventsQuotaExceededError,
  IForeventsRateLimitedError,
  Iforevents,
  Integration,
  MemoryStorage,
  flatten,
  type IntegrationResult,
  type TrackEvent,
} from "../src/index";
import { MockApi, json, sleep } from "./mock-server";

const api = new MockApi();
const ANON = /^anon_[0-9a-f]{32}$/;
beforeAll(() => api.start());
afterAll(() => api.stop());
beforeEach(() => api.reset());

let active: IForeventsAPIIntegration[] = [];
afterEach(async () => {
  for (const i of active) await i.shutdown();
  active = [];
});

function make(overrides: Partial<ConstructorParameters<typeof IForeventsAPIIntegration>[0]> = {}) {
  const integration = new IForeventsAPIIntegration({ projectKey: "pk_test", baseUrl: api.baseUrl, retryDelay: 10, flushInterval: 60, ...overrides });
  active.push(integration);
  return integration;
}

async function boot(overrides: Partial<ConstructorParameters<typeof IForeventsAPIIntegration>[0]> = {}, extra: Integration[] = []) {
  const integration = make(overrides);
  const iforevents = new Iforevents({ integrations: [integration, ...extra], context: () => ({ device_platform: "test", sdk_name: "@iforevents/core" }) });
  await iforevents.init();
  return { iforevents, integration };
}

describe("IForeventsAPIIntegration conformance", () => {
  it("1. identify lifts email/name/phone_number, sends properties and switches X-User-Id to the customId", async () => {
    const { iforevents, integration } = await boot();
    await iforevents.identify("user_1", { email: "ada@example.com", name: "Ada", phone_number: "+1", plan: "pro", nested: { a: 1 } });
    const [req] = api.byPath("/v1/events/identify");
    expect(req?.method).toBe("POST");
    expect(req?.headers["x-project-key"]).toBe("pk_test");
    expect(req?.headers["content-type"]).toBe("application/json");
    expect(req?.body).toEqual({
      custom_id: "user_1",
      email: "ada@example.com",
      name: "Ada",
      phone_number: "+1",
      properties: { plan: "pro", nested_a: 1, device_platform: "test", sdk_name: "@iforevents/core" },
    });
    expect(req?.headers["x-user-id"]).toBe("user_1");
    expect(integration.currentUserId).toBe("user_1");
    expect(integration.isIdentified).toBe(true);
  });

  it("2. track after identify carries X-User-Id and the merged traits", async () => {
    const { iforevents } = await boot({ batchSize: 1 });
    await iforevents.identify("user_1", { plan: "pro" });
    await iforevents.track("clicked", { button: "buy", plan: "override" });
    const [req] = api.byPath("/v1/events/track");
    expect(req?.headers["x-user-id"]).toBe("user_1");
    expect(req?.body).toEqual({ event_name: "clicked", event_type: "track", properties: { plan: "override", button: "buy", device_platform: "test", sdk_name: "@iforevents/core" } });
  });

  it("3. batchSize N sends nothing for N-1 events and one /batch with N events on the Nth", async () => {
    const { iforevents } = await boot({ batchSize: 3, flushInterval: 10_000 });
    await iforevents.track("a");
    await iforevents.track("b");
    await sleep(20);
    expect(api.requests).toHaveLength(0);
    await iforevents.track("c");
    await sleep(50);
    const batches = api.byPath("/v1/events/batch");
    expect(batches).toHaveLength(1);
    const events = batches[0]!.body.events as Array<Record<string, unknown>>;
    expect(events.map((e) => e.name)).toEqual(["a", "b", "c"]);
    for (const e of events) {
      expect(e.type).toBe("track");
      expect(typeof e.created_at).toBe("string");
      expect(() => new Date(e.created_at as string).toISOString()).not.toThrow();
    }
  });

  it("4. flushInterval elapses: a partial queue is sent", async () => {
    const { iforevents } = await boot({ batchSize: 50, flushInterval: 40 });
    await iforevents.track("only");
    expect(api.requests).toHaveLength(0);
    await sleep(120);
    expect(api.byPath("/v1/events/batch")).toHaveLength(1);
  });

  it("5. batchSize 1 posts /track with event_type", async () => {
    const { iforevents } = await boot({ batchSize: 1 });
    await iforevents.track("solo", { n: 1 });
    const [req] = api.byPath("/v1/events/track");
    expect(req?.body.event_type).toBe("track");
    expect(req?.body.event_name).toBe("solo");
  });

  it("6. page view is a page_view event with navigation fields", async () => {
    const { iforevents } = await boot({ batchSize: 1 });
    await iforevents.page("/pricing", { title: "Pricing" }, { navigationType: "push", previousRoute: "/" });
    const [req] = api.byPath("/v1/events/track");
    expect(req?.body).toEqual({ event_name: "/pricing", event_type: "page_view", properties: { title: "Pricing", navigation_type: "push", previous_route: "/" } });
  });

  it("7. before identify every request carries a generated, persisted anon_ id that a new instance reuses", async () => {
    const storage = new MemoryStorage();
    const { iforevents, integration } = await boot({ batchSize: 1, storage });
    await iforevents.track("first");
    await iforevents.track("second");
    const [first, second] = api.byPath("/v1/events/track");
    const anon = first?.headers["x-user-id"] as string;
    expect(anon).toMatch(ANON);
    expect(second?.headers["x-user-id"]).toBe(anon);
    expect(integration.currentUserId).toBe(anon);
    expect(integration.isIdentified).toBe(false);
    expect(storage.get("iforevents_user_id")).toBe(anon);
    expect(storage.get("iforevents_user_identified")).toBe("false");
    // A new integration on the same storage resumes the same visitor.
    const again = make({ storage });
    await again.init();
    expect(again.currentUserId).toBe(anon);
    // A different storage is a different visitor.
    const other = make({ storage: new MemoryStorage() });
    await other.init();
    expect(other.currentUserId).toMatch(ANON);
    expect(other.currentUserId).not.toBe(anon);
  });

  it("8. reset flushes the queue, then switches to a fresh anonymous id", async () => {
    const storage = new MemoryStorage();
    const { iforevents, integration } = await boot({ batchSize: 10, flushInterval: 10_000, storage });
    await iforevents.identify("user_1");
    await iforevents.track("before_logout");
    await iforevents.reset();
    const batches = api.byPath("/v1/events/batch");
    expect(batches).toHaveLength(1);
    expect(batches[0]?.headers["x-user-id"]).toBe("user_1");
    expect(integration.currentUserId).toMatch(ANON);
    expect(integration.isIdentified).toBe(false);
    expect(storage.get("iforevents_user_id")).toBe(integration.currentUserId);
    expect(storage.get("iforevents_user_identified")).toBe("false");
    expect(iforevents.currentTraits).toEqual({});
    await iforevents.track("after_logout");
    await iforevents.flush();
    const [, second] = api.byPath("/v1/events/batch");
    expect(second?.headers["x-user-id"]).toBe(integration.currentUserId);
    expect(second?.headers["x-user-id"]).not.toBe("user_1");
  });

  it("9. 500 then 200: the same events are retried and delivered once", async () => {
    let failures = 0;
    api.use((req, res) => {
      if (req.path === "/v1/events/batch" && failures < 1) {
        failures++;
        return json(res, 500, { error: "boom" });
      }
    });
    const { iforevents } = await boot({ batchSize: 2, maxRetries: 2 });
    await iforevents.track("x");
    await iforevents.track("y");
    await iforevents.flush();
    const batches = api.byPath("/v1/events/batch");
    expect(batches).toHaveLength(2);
    expect((batches[1]!.body.events as Array<{ name: string }>).map((e) => e.name)).toEqual(["x", "y"]);
  });

  it("10. 429 quota_exceeded: no retry, events dropped, onQuotaExceeded once, flag until next success", async () => {
    let refuse = true;
    api.use((req, res) => {
      if (req.path === "/v1/events/batch" && refuse) return json(res, 429, { error: "quota_exceeded", message: "plan quota exhausted", limit: 5_000_000, used: 5_000_001, org_uuid: "org-1" });
    });
    const seen: IForeventsQuotaExceededError[] = [];
    const { iforevents, integration } = await boot({ batchSize: 1_000, onQuotaExceeded: (e) => seen.push(e) });
    await iforevents.track("a");
    await iforevents.flush();
    await iforevents.track("b");
    await iforevents.flush();
    expect(api.byPath("/v1/events/batch")).toHaveLength(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.limit).toBe(5_000_000);
    expect(seen[0]?.used).toBe(5_000_001);
    expect(seen[0]?.organizationUuid).toBe("org-1");
    expect(integration.isQuotaExceeded).toBe(true);
    expect(integration.queuedEventsCount).toBe(0);
    refuse = false;
    await iforevents.track("c");
    await iforevents.flush();
    expect(integration.isQuotaExceeded).toBe(false);
    const last = api.byPath("/v1/events/batch").at(-1)!;
    expect((last.body.events as Array<{ name: string }>).map((e) => e.name)).toEqual(["c"]);
  });

  it("11. 429 rate limit with Retry-After is retried after the header's delay", async () => {
    let limited = true;
    api.use((req, res) => {
      if (req.path === "/v1/events/batch" && limited) {
        limited = false;
        return json(res, 429, { error: "ingest_rate_limit_exceeded", message: "slow down", retry_after_seconds: 1 }, { "Retry-After": "1" });
      }
    });
    const errors: unknown[] = [];
    const { iforevents } = await boot({ batchSize: 1_000, onError: (e) => errors.push(e) });
    await iforevents.track("r");
    const started = Date.now();
    await iforevents.flush();
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(api.byPath("/v1/events/batch")).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it("11b. rate limit error is typed when retries run out", async () => {
    api.use((req, res) => {
      if (req.path === "/v1/events/identify") return json(res, 429, { error: "ingest_rate_limit_exceeded" }, { "Retry-After": "0" });
    });
    const errors: unknown[] = [];
    const { iforevents } = await boot({ maxRetries: 1, onError: (e) => errors.push(e) });
    await iforevents.identify("u");
    expect(api.byPath("/v1/events/identify")).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(IForeventsRateLimitedError);
  });

  it("12. 401: no retry, events dropped, AuthError surfaced", async () => {
    const errors: unknown[] = [];
    const integration = make({ projectKey: "pk_wrong", batchSize: 1_000, onError: (e) => errors.push(e) });
    const iforevents = new Iforevents({ integrations: [integration] });
    await iforevents.init();
    await iforevents.track("a");
    await iforevents.flush();
    expect(api.byPath("/v1/events/batch")).toHaveLength(1);
    expect(integration.queuedEventsCount).toBe(0);
    expect(errors[0]).toBeInstanceOf(IForeventsAuthError);
    expect((errors[0] as IForeventsAuthError).status).toBe(401);
  });

  it("13. a throwing third-party integration does not stop the API integration", async () => {
    class Broken extends Integration {
      override async track(event: TrackEvent): Promise<void> {
        await super.track(event);
        throw new Error("vendor down");
      }
    }
    const results: IntegrationResult[][] = [];
    const integration = make({ batchSize: 1 });
    const iforevents = new Iforevents({ integrations: [new Broken(), integration], onResult: (r) => results.push(r) });
    await iforevents.init();
    const r = await iforevents.track("still_delivered");
    expect(r.map((x) => [x.integration, x.success])).toEqual([
      ["Broken", false],
      ["IForeventsAPIIntegration", true],
    ]);
    expect(api.byPath("/v1/events/track")).toHaveLength(1);
  });

  it("14. no request ever carries a string named secret", async () => {
    const { iforevents } = await boot({ batchSize: 1 });
    await iforevents.identify("u", { plan: "pro" });
    await iforevents.track("t");
    await iforevents.page("/p");
    for (const req of api.requests) {
      expect(JSON.stringify(req.body).toLowerCase()).not.toContain("secret");
      expect(Object.keys(req.headers).join(",").toLowerCase()).not.toContain("secret");
    }
    expect(() => new IForeventsAPIIntegration({ projectKey: "pk", projectSecret: "nope" } as never)).toThrow(/secret/);
  });

  it("14b. only CORS-allowlisted headers are sent (content-type, x-project-key, x-user-id)", async () => {
    const { iforevents } = await boot({ batchSize: 1 });
    await iforevents.identify("u");
    await iforevents.track("t");
    const allowed = new Set(["content-type", "x-project-key", "x-user-id", "accept", "accept-encoding", "accept-language", "user-agent", "host", "connection", "content-length", "sec-fetch-mode", "keep-alive"]);
    for (const req of api.requests) {
      for (const h of Object.keys(req.headers)) expect(allowed.has(h), `unexpected header ${h}`).toBe(true);
    }
  });

  it("fetch is invoked with the global as `this` (browsers throw Illegal invocation otherwise)", async () => {
    let receiver: unknown = "unset";
    const strictFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      receiver = this;
      return fetch(...args);
    } as typeof fetch;
    const { iforevents } = await boot({ batchSize: 1, fetch: strictFetch });
    await iforevents.track("who");
    expect(receiver).toBe(globalThis);
  });

  it("identify attributes even when the profile request fails", async () => {
    api.use((req, res) => (req.path === "/v1/events/identify" ? json(res, 500, { error: "down" }) : false));
    const { iforevents, integration } = await boot({ batchSize: 1, maxRetries: 0 });
    await iforevents.identify("user_x");
    expect(integration.currentUserId).toBe("user_x");
    await iforevents.track("still_attributed");
    expect(api.byPath("/v1/events/track")[0]?.headers["x-user-id"]).toBe("user_x");
  });

  it("15. nested properties are flattened with _", () => {
    expect(flatten({ a: { b: { c: 1 } }, list: [1, { d: 2 }], date: new Date(0), plain: "x" })).toEqual({ a_b_c: 1, list: [1, { d: 2 }], date: new Date(0), plain: "x" });
  });

  it("queues persist across restarts when persistQueue is on", async () => {
    const storage = new MemoryStorage();
    const first = make({ batchSize: 100, flushInterval: 10_000, storage, persistQueue: true });
    await first.init();
    await first.track({ name: "offline", type: "track", properties: {}, timestamp: new Date() });
    expect(storage.get("iforevents_queue")).toContain("offline");
    const second = make({ batchSize: 100, flushInterval: 10_000, storage, persistQueue: true });
    await second.init();
    expect(second.queuedEventsCount).toBe(1);
    await second.flush();
    expect(api.byPath("/v1/events/batch")).toHaveLength(1);
    expect(storage.get("iforevents_queue")).toBeNull();
  });

  it("calls before init are ignored with no throw", async () => {
    const iforevents = new Iforevents({ integrations: [make()] });
    await expect(iforevents.track("early")).resolves.toEqual([]);
    await expect(iforevents.identify("u")).resolves.toEqual([]);
    expect(api.requests).toHaveLength(0);
  });

  it("throwOnError rejects identify and flush", async () => {
    api.use((req, res) => json(res, 500, { error: "down" }));
    const { iforevents, integration } = await boot({ maxRetries: 0, throwOnError: true, batchSize: 1_000 });
    await expect(integration.identify({ customId: "u", traits: {} })).rejects.toThrow(/down/);
    await iforevents.track("x");
    await expect(integration.flush()).rejects.toThrow(/down/);
    // The chain recovers: once the api is healthy the queued event goes out.
    api.use(null);
    await integration.flush();
    expect(api.byPath("/v1/events/batch").at(-1)?.body.events).toHaveLength(1);
  });
});
