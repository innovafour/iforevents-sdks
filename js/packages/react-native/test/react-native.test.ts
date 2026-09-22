import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, sleep } from "../../core/test/mock-server";
import { MemoryStorage } from "@iforevents/core";
import { createReactNativeIforevents, reactNativeContext, trackNavigation } from "../src/index";
import { AppState } from "./react-native.mock";

const api = new MockApi();
beforeAll(() => api.start());
afterAll(() => api.stop());
beforeEach(() => api.reset());

describe("@iforevents/react-native", () => {
  it("context uses Platform when device-info is absent", async () => {
    const ctx = await reactNativeContext({ app: "demo" });
    expect(ctx).toMatchObject({ device_platform: "ios", device_os_version: "17.5", sdk_name: "@iforevents/react-native", app: "demo" });
  });

  it("queues calls until storage is ready, persists the queue, flushes on background", async () => {
    const storage = new MemoryStorage();
    const client = createReactNativeIforevents("pk_test", { baseUrl: api.baseUrl, batchSize: 50, flushInterval: 10_000, storage });
    const p = client.identify("rn_user", { plan: "pro" });
    await client.track("opened");
    await p;
    expect(storage.get("iforevents_user_id")).toBe("rn_user");
    expect(storage.get("iforevents_user_identified")).toBe("true");
    expect(storage.get("iforevents_queue")).toContain("opened");
    (AppState as unknown as { __emit(s: string): void }).__emit("background");
    await sleep(60);
    const [batch] = api.byPath("/v1/events/batch");
    expect(batch?.headers["x-user-id"]).toBe("rn_user");
    expect((batch?.body.events as Array<{ name: string; properties: Record<string, unknown> }>)[0]).toMatchObject({ name: "opened", properties: { plan: "pro", device_platform: "ios" } });
    await client.shutdown();
  });

  it("trackNavigation sends one screen per route change", async () => {
    const screens: unknown[][] = [];
    const client = { screen: async (...a: unknown[]) => (screens.push(a), []) };
    let route = "Home";
    const ref = { current: { getCurrentRoute: () => ({ name: route }) } };
    const handlers = trackNavigation(client, ref);
    handlers.onReady();
    handlers.onStateChange();
    route = "Settings";
    handlers.onStateChange();
    expect(screens).toEqual([
      ["Home", {}, { navigationType: "load", previousRoute: undefined, toRoute: "Home" }],
      ["Settings", {}, { navigationType: "navigate", previousRoute: "Home", toRoute: "Settings" }],
    ]);
  });
});
