import { act, render, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, sleep } from "../../core/test/mock-server";
import { IforeventsProvider, useIforevents, usePageView, useTrack, type AnalyticsClient } from "../src/index";

const api = new MockApi();
beforeAll(() => api.start());
afterAll(() => api.stop());
beforeEach(() => {
  api.reset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("@iforevents/react", () => {
  it("provider creates a browser client from the project key; useTrack sends events", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <IforeventsProvider projectKey="pk_test" options={{ baseUrl: api.baseUrl, batchSize: 1 }}>
        {children}
      </IforeventsProvider>
    );
    const { result } = renderHook(() => useTrack(), { wrapper });
    await act(async () => {
      await result.current("clicked", { where: "hook" });
    });
    const [req] = api.byPath("/v1/events/track");
    expect(req?.body.event_name).toBe("clicked");
    expect((req?.body.properties as Record<string, unknown>).where).toBe("hook");
  });

  it("usePageView fires on mount and on path change with previous route", async () => {
    const calls: unknown[][] = [];
    const client: AnalyticsClient = {
      track: async () => [],
      page: async (...a) => {
        calls.push(a);
        return [];
      },
      identify: async () => [],
      reset: async () => [],
    };
    function Page({ path }: { path: string }) {
      usePageView(path, { app: "t" });
      return <div>{path}</div>;
    }
    const view = render(
      <IforeventsProvider client={client}>
        <Page path="/a" />
      </IforeventsProvider>,
    );
    view.rerender(
      <IforeventsProvider client={client}>
        <Page path="/b" />
      </IforeventsProvider>,
    );
    await sleep(10);
    expect(calls).toEqual([
      ["/a", { app: "t" }, { navigationType: "load", previousRoute: undefined, toRoute: "/a" }],
      ["/b", { app: "t" }, { navigationType: "route", previousRoute: "/a", toRoute: "/b" }],
    ]);
  });

  it("useIforevents throws outside the provider", () => {
    expect(() => renderHook(() => useIforevents())).toThrow(/IforeventsProvider/);
  });
});
