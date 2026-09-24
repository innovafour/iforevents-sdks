import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIforevents, nodeContext, nodeEventContext } from "../src/index";
import { platform } from "node:os";
import { MockApi } from "../../core/test/mock-server";

const api = new MockApi();
beforeAll(() => api.start());
afterAll(() => api.stop());

describe("@iforevents/node", () => {
  it("collects server context with the contract key names", () => {
    const ctx = nodeContext({ app: "billing" });
    expect(ctx.sdk_name).toBe("@iforevents/node");
    expect(ctx.device_platform).toBe("server");
    expect(String(ctx.runtime)).toMatch(/^node\//);
    expect(ctx.app).toBe("billing");
  });

  it("sends the schema 2 context: library, server device, OS, locale and time zone", async () => {
    const ctx = nodeEventContext();
    expect(ctx.library).toEqual({ name: "@iforevents/node", version: expect.any(String) });
    expect(ctx.device).toEqual({ type: "server" });
    expect(ctx.os?.name).toBe(platform());
    expect(typeof ctx.timezone).toBe("string");
  });

  it("createIforevents wires the api integration, user agent and shutdown", async () => {
    const { iforevents, api: integration, shutdown } = await createIforevents({ projectKey: "pk_test", baseUrl: api.baseUrl, batchSize: 5, flushOnExit: false });
    expect(integration?.isInitialized).toBe(true);
    await iforevents.identify("srv_user", { email: "a@b.c" });
    await iforevents.track("job_done", { ms: 12 });
    await shutdown();
    const identify = api.byPath("/v1/events/identify")[0]!;
    expect(String(identify.headers["user-agent"])).toMatch(/^iforevents-node\//);
    expect((identify.body.properties as Record<string, unknown>).device_platform).toBe("server");
    const batch = api.byPath("/v1/events/batch")[0]!;
    expect(batch.headers["x-user-id"]).toBe("srv_user");
    expect((batch.body.context as { library?: { name?: string } }).library?.name).toBe("@iforevents/node");
    expect((batch.body.events as Array<{ name: string }>)[0]?.name).toBe("job_done");
    expect(iforevents.isInitialized).toBe(false);
  });

  it("disableApi keeps only custom integrations", async () => {
    const { api: integration } = await createIforevents({ projectKey: "pk_test", disableApi: true, flushOnExit: false });
    expect(integration).toBeNull();
  });
});
