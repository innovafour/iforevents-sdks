import { describe, expect, it } from "vitest";
import { Iforevents } from "@iforevents/core";
import { PostHogIntegration, type PostHogBrowserClient } from "../src/browser";
import { PostHogIntegration as PostHogNode, type PostHogNodeClient } from "../src/node";

describe("@iforevents/posthog", () => {
  it("browser: identify/capture/$pageview/reset", async () => {
    const calls: unknown[] = [];
    const client: PostHogBrowserClient = {
      init: () => undefined,
      identify: (id, p) => calls.push(["identify", id, p]),
      capture: (e, p) => calls.push(["capture", e, p]),
      reset: () => calls.push(["reset"]),
    };
    const ife = new Iforevents({ integrations: [new PostHogIntegration({ client })], context: () => ({}) });
    await ife.init();
    await ife.identify("u", { plan: "pro" });
    await ife.track("t", { a: 1 });
    await ife.page("Home");
    await ife.reset();
    expect(calls).toEqual([
      ["identify", "u", { plan: "pro" }],
      ["capture", "t", { plan: "pro", a: 1 }],
      ["capture", "$pageview", { screen_name: "Home" }],
      ["reset"],
    ]);
  });

  it("node: distinct id switches after identify and shutdown is forwarded", async () => {
    const calls: unknown[] = [];
    const client: PostHogNodeClient = {
      identify: (m) => calls.push(["identify", m]),
      capture: (m) => calls.push(["capture", m]),
      shutdown: async () => {
        calls.push(["shutdown"]);
      },
    };
    const ife = new Iforevents({ integrations: [new PostHogNode({ client })], context: () => ({}) });
    await ife.init();
    await ife.track("anon");
    await ife.identify("u", {});
    await ife.track("known");
    await ife.shutdown();
    expect(calls[0]).toMatchObject(["capture", { distinctId: "server", event: "anon" }]);
    expect(calls[2]).toMatchObject(["capture", { distinctId: "u", event: "known" }]);
    expect(calls.at(-1)).toEqual(["shutdown"]);
  });
});
