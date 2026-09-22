import { render } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, sleep } from "../../core/test/mock-server";
import { IforeventsProvider, type AnalyticsClient } from "../src/index";
import { getServerIforevents, resetServerIforevents } from "../src/server";
import { setRoute } from "./next-navigation.mock";

const api = new MockApi();
beforeAll(() => api.start());
afterAll(() => api.stop());
beforeEach(() => api.reset());

describe("@iforevents/next", () => {
  it("sends a page view per App Router navigation, with query string", async () => {
    const calls: unknown[][] = [];
    const client: AnalyticsClient = { track: async () => [], page: async (...a) => (calls.push(a), []), identify: async () => [], reset: async () => [] };
    setRoute("/", "");
    const view = render(<IforeventsProvider client={client}>x</IforeventsProvider>);
    setRoute("/pricing", "plan=pro");
    view.rerender(<IforeventsProvider client={client}>y</IforeventsProvider>);
    view.rerender(<IforeventsProvider client={client}>z</IforeventsProvider>);
    await sleep(10);
    expect(calls).toEqual([
      ["/", { search: "" }, { navigationType: "load", previousRoute: undefined, toRoute: "/" }],
      ["/pricing", { search: "plan=pro" }, { navigationType: "route", previousRoute: "/", toRoute: "/pricing?plan=pro" }],
    ]);
  });

  it("trackPageViews=false sends nothing", async () => {
    const calls: unknown[] = [];
    const client: AnalyticsClient = { track: async () => [], page: async (...a) => (calls.push(a), []), identify: async () => [], reset: async () => [] };
    render(
      <IforeventsProvider client={client} trackPageViews={false}>
        x
      </IforeventsProvider>,
    );
    await sleep(10);
    expect(calls).toEqual([]);
  });

  it("server entry is a process-wide singleton that ingests", async () => {
    const a = await getServerIforevents({ projectKey: "pk_test", baseUrl: api.baseUrl, batchSize: 1, flushOnExit: false });
    const b = await getServerIforevents({ projectKey: "other" });
    expect(a).toBe(b);
    await a.iforevents.track("server_event");
    expect(api.byPath("/v1/events/track")[0]?.body.event_name).toBe("server_event");
    await resetServerIforevents();
    const c = await getServerIforevents({ projectKey: "pk_test", baseUrl: api.baseUrl, flushOnExit: false });
    expect(c).not.toBe(a);
    await resetServerIforevents();
  });
});
