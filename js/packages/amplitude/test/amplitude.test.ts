import { describe, expect, it } from "vitest";
import { Iforevents } from "@iforevents/core";
import { AmplitudeIntegration, type AmplitudeBrowserClient } from "../src/browser";
import { AmplitudeIntegration as AmplitudeNode, type AmplitudeNodeClient } from "../src/node";

class FakeIdentify {
  props: Record<string, unknown> = {};
  set(k: string, v: string | number | boolean) {
    this.props[k] = v;
    return this;
  }
}

describe("@iforevents/amplitude", () => {
  it("browser: sets user id, identify props, tracks and resets", async () => {
    const calls: unknown[] = [];
    const client: AmplitudeBrowserClient = {
      init: () => ({ promise: Promise.resolve() }),
      setUserId: (id) => calls.push(["setUserId", id]),
      identify: (id) => calls.push(["identify", (id as FakeIdentify).props]),
      track: (n, p) => calls.push(["track", n, p]),
      reset: () => calls.push(["reset"]),
      Identify: FakeIdentify,
    };
    const ife = new Iforevents({ integrations: [new AmplitudeIntegration({ client })], context: () => ({}) });
    await ife.init();
    await ife.identify("u1", { plan: "pro" });
    await ife.track("buy", { total: 9 });
    await ife.page("/x");
    await ife.reset();
    expect(calls).toEqual([
      ["setUserId", "u1"],
      ["identify", { plan: "pro" }],
      ["track", "buy", { plan: "pro", total: 9 }],
      ["track", "/x", {}],
      ["reset"],
    ]);
  });

  it("node: targets device_id when anonymous and user_id after identify; flushes on shutdown", async () => {
    const calls: unknown[] = [];
    const client: AmplitudeNodeClient = {
      init: () => undefined,
      identify: (id, o) => calls.push(["identify", (id as FakeIdentify).props, o]),
      track: (n, p, o) => calls.push(["track", n, p, o]),
      flush: () => calls.push(["flush"]),
      Identify: FakeIdentify,
    };
    const ife = new Iforevents({ integrations: [new AmplitudeNode({ client, deviceId: "srv-1" })], context: () => ({}) });
    await ife.init();
    await ife.track("anon");
    await ife.identify("u2", { tier: "gold" });
    await ife.track("paid");
    await ife.shutdown();
    expect(calls[0]).toMatchObject(["track", "anon", {}, { device_id: "srv-1" }]);
    expect(calls[1]).toEqual(["identify", { tier: "gold" }, { user_id: "u2" }]);
    expect(calls[2]).toMatchObject(["track", "paid", { tier: "gold" }, { user_id: "u2" }]);
    expect(calls.at(-1)).toEqual(["flush"]);
  });
});
