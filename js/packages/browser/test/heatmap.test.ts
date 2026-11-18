import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockApi } from "../../core/test/mock-server";
import { HEATMAP_PREVIEW_NAME, HeatmapRecorder, createBrowserIforevents, selectorOf, type HeatmapPayload } from "../src/index";

function click(el: Element, x = 100, y = 200): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
}

describe("heatmaps", () => {
  let sent: HeatmapPayload[];
  let recorder: HeatmapRecorder;
  const sender = async (p: HeatmapPayload) => {
    sent.push(p);
  };

  beforeEach(() => {
    sent = [];
    window.name = "";
    document.body.innerHTML = `
      <header><img class="logo" alt="Acme"></header>
      <main>
        <section class="plans"><a class="cta" href="#start"><span>Start free</span></a>
          <button id="buy" type="button">Buy now</button>
          <p class="note">Plain text people click on</p>
          <input name="email" placeholder="Your e-mail" value="secret@example.com">
        </section>
        <div data-iforevents-ignore><button class="hidden-thing">Private</button></div>
      </main>`;
  });
  afterEach(async () => {
    await recorder?.stop();
    vi.useRealTimers();
  });

  it("records clicks with the interactive element, its selector and text, never field values", async () => {
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    click(document.querySelector(".cta span")!);
    click(document.querySelector("input")!);
    click(document.querySelector(".hidden-thing")!);
    await recorder.flush();
    const p = sent[0]!;
    expect(p.platform).toBe("web");
    expect(p.url).toBe(window.location.href);
    expect(p.page_view_id).toMatch(/^[0-9a-f]{24}$/);
    const clicks = p.items.filter((i) => i.k === "click");
    expect(clicks).toHaveLength(2);
    expect(clicks[0]).toMatchObject({ s: "main > section.plans > a.cta", tag: "a", txt: "Start free" });
    expect(clicks[1]).toMatchObject({ tag: "input", txt: "Your e-mail" });
    expect(JSON.stringify(p)).not.toContain("secret@example.com");
    expect(JSON.stringify(p)).not.toContain("Private");
    const scroll = p.items.find((i) => i.k === "scroll");
    expect(scroll).toBeDefined();
  });

  it("detects a rage click burst once and a dead click on something that never reacts", async () => {
    vi.useFakeTimers();
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    const note = document.querySelector(".note")!;
    for (let i = 0; i < 4; i++) click(note, 300, 300);
    vi.advanceTimersByTime(1200);
    await recorder.flush();
    const kinds = sent[0]!.items.map((i) => i.k);
    expect(kinds.filter((k) => k === "click")).toHaveLength(4);
    expect(kinds.filter((k) => k === "rage_click")).toHaveLength(1);
    expect(sent[0]!.items.find((i) => i.k === "rage_click")!.v).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((k) => k === "dead_click").length).toBeGreaterThan(0);
  });

  it("does not call a click dead when the page reacted, or when it was a link", async () => {
    vi.useFakeTimers();
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    const buy = document.querySelector("#buy")!;
    buy.addEventListener("click", () => buy.setAttribute("data-state", "open"));
    click(buy);
    click(document.querySelector(".cta")!);
    await Promise.resolve();
    vi.advanceTimersByTime(1200);
    await recorder.flush();
    expect(sent[0]!.items.filter((i) => i.k === "dead_click")).toHaveLength(0);
    expect(selectorOf(buy)).toBe("button#buy");
  });

  it("aggregates mouse movement into cells and sends deltas", async () => {
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    const now = vi.spyOn(Date, "now");
    let t = 1_000_000;
    now.mockImplementation(() => (t += 200));
    for (let i = 0; i < 5; i++) document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    await recorder.flush();
    const moves = sent[0]!.items.filter((i) => i.k === "move");
    expect(moves).toHaveLength(1);
    expect(moves[0]!.n).toBe(5);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    await recorder.flush();
    expect(sent[1]!.items.find((i) => i.k === "move")!.n).toBe(1);
    now.mockRestore();
  });

  it("masks text when asked and records nothing in the dashboard's preview", async () => {
    recorder = new HeatmapRecorder(sender, { maskText: true });
    recorder.start();
    click(document.querySelector("#buy")!);
    await recorder.flush();
    expect(sent[0]!.items[0]!.txt).toBeUndefined();
    await recorder.stop();

    sent = [];
    window.name = HEATMAP_PREVIEW_NAME;
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    click(document.querySelector("#buy")!);
    await recorder.flush();
    expect(sent).toHaveLength(0);
  });

  it("samples page views", async () => {
    recorder = new HeatmapRecorder(sender, { sampleRate: 0 });
    recorder.start();
    click(document.querySelector("#buy")!);
    await recorder.flush();
    expect(sent).toHaveLength(0);
  });

  it("starts a new page view when a single-page app changes route", async () => {
    recorder = new HeatmapRecorder(sender);
    recorder.start();
    click(document.querySelector("#buy")!);
    const first = (await (async () => {
      history.pushState({}, "", "/checkout");
      recorder.newPageView();
      return sent[0]!;
    })())!;
    click(document.querySelector("#buy")!);
    await recorder.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.page_view_id).not.toBe(first.page_view_id);
    expect(sent[1]!.url).toContain("/checkout");
    history.pushState({}, "", "/");
  });
});

describe("createBrowserIforevents heatmaps", () => {
  const api = new MockApi();
  beforeEach(async () => {
    await api.start();
    api.reset();
  });
  afterEach(() => api.stop());

  it("posts heatmap batches with the project key and the user id, and can be turned off", async () => {
    const client = createBrowserIforevents("pk_test", { baseUrl: api.baseUrl, batchSize: 1 });
    await client.track("ready");
    expect(client.heatmaps).not.toBeNull();
    click(document.body);
    await client.heatmaps!.flush();
    const [req] = api.byPath("/v1/events/heatmap");
    expect(req?.headers["x-project-key"]).toBe("pk_test");
    expect(String(req?.headers["x-user-id"])).toMatch(/^anon_/);
    expect((req?.body.items as unknown[]).length).toBeGreaterThan(0);
    await client.shutdown();

    const off = createBrowserIforevents("pk_test", { baseUrl: api.baseUrl, heatmaps: false });
    expect(off.heatmaps).toBeNull();
    await off.shutdown();
  });
});
