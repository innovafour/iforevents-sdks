import { describe, expect, it } from "vitest";
import { Iforevents } from "@iforevents/core";
import { GA4Integration } from "../src/browser";

describe("@iforevents/ga4", () => {
  it("configures, identifies, tracks, pages and resets through gtag", async () => {
    const calls: unknown[][] = [];
    const gtag = (...a: unknown[]) => calls.push(a);
    const ife = new Iforevents({ integrations: [new GA4Integration({ measurementId: "G-1", gtag })], context: () => ({}) });
    await ife.init();
    await ife.identify("u", { plan: "pro" });
    await ife.track("buy", { value: 1 });
    await ife.page("Home", {}, { toRoute: "/" });
    await ife.reset();
    expect(calls).toEqual([
      ["config", "G-1", { send_page_view: false }],
      ["config", "G-1", { user_id: "u", send_page_view: false }],
      ["set", "user_properties", { plan: "pro" }],
      ["event", "buy", { plan: "pro", value: 1 }],
      ["event", "page_view", { page_title: "Home", page_path: "/" }],
      ["config", "G-1", { user_id: null, send_page_view: false }],
    ]);
  });
});
