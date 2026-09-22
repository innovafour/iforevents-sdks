import { describe, expect, it } from "vitest";
import { Iforevents } from "@iforevents/core";
import { MixpanelIntegration, type MixpanelBrowserClient } from "../src/browser";
import { MixpanelIntegration as MixpanelNode, type MixpanelNodeClient } from "../src/node";
import { loadVendor } from "../src/_vendor";

describe("@iforevents/mixpanel", () => {
  it("browser: forwards identify, track, page and reset", async () => {
    const calls: unknown[] = [];
    const client: MixpanelBrowserClient = {
      init: (...a) => calls.push(["init", ...a]),
      identify: (id) => calls.push(["identify", id]),
      track: (n, p) => calls.push(["track", n, p]),
      reset: () => calls.push(["reset"]),
      people: { set: (p) => calls.push(["people.set", p]) },
    };
    const ife = new Iforevents({ integrations: [new MixpanelIntegration({ client })], context: () => ({}) });
    await ife.init();
    await ife.identify("u1", { email: "a@b.c", nested: { x: 1 }, nil: null });
    await ife.track("buy", { total: 9 });
    await ife.page("/home", {}, { navigationType: "load" });
    await ife.reset();
    expect(calls).toEqual([
      ["identify", "u1"],
      ["people.set", { email: "a@b.c", nested_x: 1 }],
      ["track", "buy", { email: "a@b.c", nested_x: 1, total: 9 }],
      ["track", "/home", { navigation_type: "load" }],
      ["reset"],
    ]);
  });

  it("node: sets distinct_id after identify and clears it on reset", async () => {
    const calls: unknown[] = [];
    const client: MixpanelNodeClient = {
      track: (n, p, cb) => {
        calls.push(["track", n, p]);
        cb?.();
      },
      people: {
        set: (id, p, cb) => {
          calls.push(["people.set", id, p]);
          cb?.();
        },
      },
    };
    const ife = new Iforevents({ integrations: [new MixpanelNode({ client })], context: () => ({}) });
    await ife.init();
    await ife.track("anon");
    await ife.identify("u9", { plan: "pro" });
    await ife.track("paid", { amount: 1 });
    await ife.reset();
    await ife.track("anon_again");
    const tracks = calls.filter((c) => (c as unknown[])[0] === "track") as Array<[string, string, Record<string, unknown>]>;
    expect(tracks[0]?.[2].distinct_id).toBeUndefined();
    expect(tracks[1]?.[2]).toMatchObject({ distinct_id: "u9", plan: "pro", amount: 1 });
    expect(typeof tracks[1]?.[2].time).toBe("number");
    expect(tracks[2]?.[2].distinct_id).toBeUndefined();
    expect(calls[1]).toEqual(["people.set", "u9", { plan: "pro" }]);
  });

  it("a missing vendor package is reported at init, never thrown at construction", async () => {
    await expect(loadVendor("@iforevents/package-that-does-not-exist")).rejects.toThrow(/npm install @iforevents\/package-that-does-not-exist/);
    const integration = new MixpanelIntegration({ token: "t" }); // no throw
    expect(integration.name).toBe("MixpanelIntegration");
  });
});
