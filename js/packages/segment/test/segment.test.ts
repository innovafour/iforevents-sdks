import { describe, expect, it } from "vitest";
import { Iforevents } from "@iforevents/core";
import { SegmentIntegration, type SegmentBrowserClient } from "../src/browser";
import { SegmentIntegration as SegmentNode, type SegmentNodeClient } from "../src/node";

describe("@iforevents/segment", () => {
  it("browser: identify/track/page/reset", async () => {
    const calls: unknown[] = [];
    const client: SegmentBrowserClient = {
      identify: (id, t) => calls.push(["identify", id, t]),
      track: (e, p) => calls.push(["track", e, p]),
      page: (c, n, p) => calls.push(["page", c, n, p]),
      reset: () => calls.push(["reset"]),
    };
    const ife = new Iforevents({ integrations: [new SegmentIntegration({ client })], context: () => ({}) });
    await ife.init();
    await ife.identify("u", { plan: "pro" });
    await ife.track("t", { a: 1 });
    await ife.page("Home", { s: 1 });
    await ife.reset();
    expect(calls).toEqual([
      ["identify", "u", { plan: "pro" }],
      ["track", "t", { plan: "pro", a: 1 }],
      ["page", undefined, "Home", { s: 1 }],
      ["reset"],
    ]);
  });

  it("node: anonymousId before identify, userId after, closeAndFlush on shutdown", async () => {
    const calls: unknown[] = [];
    const client: SegmentNodeClient = {
      identify: (m) => calls.push(["identify", m]),
      track: (m) => calls.push(["track", m]),
      page: (m) => calls.push(["page", m]),
      closeAndFlush: async () => {
        calls.push(["closeAndFlush"]);
      },
    };
    const ife = new Iforevents({ integrations: [new SegmentNode({ client })], context: () => ({}) });
    await ife.init();
    await ife.track("anon");
    await ife.identify("u", { plan: "pro" });
    await ife.track("known");
    await ife.shutdown();
    expect(calls[0]).toMatchObject(["track", { anonymousId: "server", event: "anon" }]);
    expect(calls[1]).toEqual(["identify", { userId: "u", traits: { plan: "pro" } }]);
    expect(calls[2]).toMatchObject(["track", { userId: "u", event: "known", properties: { plan: "pro" } }]);
    expect(calls.at(-1)).toEqual(["closeAndFlush"]);
  });
});
