/*
 * IForevents heatmaps for the browser (no dependencies).
 *
 * Records what people do on each page and sends it, aggregated, to
 * POST /v1/events/heatmap: clicks with the element clicked, rage clicks
 * (a burst on one spot), dead clicks (a click nothing reacted to), mouse
 * movement as a grid of cells, hesitation (resting on a link or button
 * without clicking), exit intent (the pointer leaving through the top of
 * the window), copied text, how far down the page was seen, and how long
 * each 5% band of the page was on screen.
 *
 * Coordinates are relative to the document, not the window: x in
 * hundredths of a percent of the page's width (0 to 10000), y in CSS
 * pixels from the top. Never recorded: what is typed, the value of any
 * field, anything inside an element marked `data-iforevents-ignore` (or
 * the `ignore` selector), and text at all with `maskText`.
 *
 * Nothing is recorded inside the dashboard's own preview of the page (an
 * iframe named `iforevents-heatmap-preview`, or `?__iforevents_preview` in
 * the address).
 *
 * The same file is used by @iforevents/browser and by the single-file
 * snippet (iforevents-landing/lib/sdk); keep the two copies identical.
 */

export interface HeatmapOptions {
  /** Share of page views recorded, 0 to 1 (default 1). */
  sampleRate?: number;
  /** Record mouse movement (default true). */
  mouseMove?: boolean;
  /** Never send element or copied text (default false). */
  maskText?: boolean;
  /** Elements matching this selector, and what is inside them, are not recorded. */
  ignore?: string;
  /** Milliseconds between sends while the page is open (default 15000). */
  flushInterval?: number;
  /** Turns a URL into the page name heatmaps are grouped by (default: its path). */
  pageName?: (url: URL) => string;
}

/** One interaction as the api takes it. */
export interface HeatmapItem {
  k: string;
  x: number;
  y: number;
  v?: number;
  n?: number;
  s?: string;
  tag?: string;
  txt?: string;
  t?: number;
}

export interface HeatmapPayload {
  page_view_id: string;
  url: string;
  page?: string;
  platform: string;
  viewport: { w: number; h: number };
  document: { w: number; h: number };
  created_at: string;
  items: HeatmapItem[];
}

export type HeatmapSender = (payload: HeatmapPayload, keepalive: boolean) => Promise<void>;

export const HEATMAP_PREVIEW_NAME = "iforevents-heatmap-preview";

const INTERACTIVE = "a[href],button,input,select,textarea,label,summary,option,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[onclick],[contenteditable=''],[contenteditable=true],[data-iftrack]";
const MOVE_CELL_W = 200; // 2% of the width
const MOVE_CELL_H = 32;
const MAX_MOVE_CELLS = 300;
const MAX_ITEMS = 1500;
const BANDS = 20;
const TICK_MS = 500;
const RAGE_CLICKS = 3;
const RAGE_WINDOW_MS = 800;
const RAGE_RADIUS_PX = 30;
const DEAD_WAIT_MS = 1000;
const HESITATION_MS = 800;
const MOVE_THROTTLE_MS = 120;

/** True inside the dashboard's preview of a page, where nothing is recorded. */
export function isHeatmapPreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.name === HEATMAP_PREVIEW_NAME) return true;
    return /[?&]__iforevents_preview(=|&|$)/.test(window.location.search);
  } catch {
    return false;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let hex = "";
  for (const b of bytes) hex += (b < 16 ? "0" : "") + b.toString(16);
  return hex;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function docWidth(): number {
  const d = document.documentElement;
  return Math.max(d.scrollWidth, d.clientWidth, 1);
}

function docHeight(): number {
  const d = document.documentElement;
  const b = document.body;
  return Math.max(d.scrollHeight, d.clientHeight, b ? b.scrollHeight : 0, 1);
}

function clean(text: string | null | undefined, max = 80): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// A class or id that looks generated (CSS modules, hashes, ids with long
// numbers) changes with every build: it would split one element into many.
function stable(token: string): boolean {
  return /^[A-Za-z_][\w-]{0,40}$/.test(token) && !/\d{3,}/.test(token) && !/[a-z][A-Z0-9]{4,}$/.test(token) && !/__[\w-]{4,}$/.test(token);
}

/** A short CSS selector for an element, stable across page loads. */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 5 && cur !== document.body && cur !== document.documentElement; depth++) {
    let part = cur.tagName.toLowerCase();
    if (cur.id && stable(cur.id)) {
      parts.unshift(part + "#" + cur.id);
      break;
    }
    const testId = cur.getAttribute("data-testid") || cur.getAttribute("data-iftrack");
    if (testId && testId.length <= 40) {
      part += `[${cur.hasAttribute("data-testid") ? "data-testid" : "data-iftrack"}="${testId.replace(/"/g, "")}"]`;
      parts.unshift(part);
      break;
    }
    const classes = Array.from(cur.classList).filter(stable).slice(0, 2);
    if (classes.length) part += "." + classes.join(".");
    const parent: Element | null = cur.parentElement;
    if (parent && !classes.length) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
  }
  return parts.join(" > ");
}

function elementText(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt");
  if (label) return clean(label);
  if (tag === "input" || tag === "textarea" || tag === "select") {
    // Never the value someone typed: what the field is called.
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit" || type === "button") return clean((el as HTMLInputElement).value);
    return clean(el.getAttribute("placeholder") || el.getAttribute("name"));
  }
  if (el.closest("input,textarea,[contenteditable]")) return "";
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return clean(text);
}

interface PageState {
  id: string;
  url: string;
  page?: string;
  startedAt: number;
  items: HeatmapItem[];
  moves: Map<string, number>;
  attention: number[];
  maxBottom: number;
  visibleMs: number;
  exitSent: boolean;
  dirty: boolean;
}

/**
 * Records one page view at a time. `start()` attaches the listeners,
 * `newPageView()` closes the current view (sending what is left) and opens
 * another (single-page apps call it on every route change), `stop()`
 * sends what is left and detaches.
 */
export class HeatmapRecorder {
  private readonly opts: Required<Omit<HeatmapOptions, "pageName" | "ignore">> & Pick<HeatmapOptions, "pageName" | "ignore">;
  private state: PageState | null = null;
  private sampled = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private cleanups: Array<() => void> = [];
  private recent: Array<{ t: number; x: number; y: number }> = [];
  private rageUntil = 0;
  private lastMove = 0;
  private hover: { el: Element; since: number; x: number; y: number; clicked: boolean } | null = null;
  private lastMutation = 0;
  private lastTick = 0;
  private sending = false;

  constructor(
    private readonly send: HeatmapSender,
    options: HeatmapOptions = {},
  ) {
    this.opts = {
      sampleRate: options.sampleRate ?? 1,
      mouseMove: options.mouseMove ?? true,
      maskText: options.maskText ?? false,
      flushInterval: options.flushInterval ?? 15000,
      ignore: options.ignore,
      pageName: options.pageName,
    };
  }

  get active(): boolean {
    return this.sampled && this.state !== null;
  }

  start(): void {
    if (typeof window === "undefined" || typeof document === "undefined" || this.cleanups.length) return;
    if (isHeatmapPreview()) return;
    this.open();
    const on = <K extends keyof DocumentEventMap>(target: Document | Window, type: K | string, fn: (e: never) => void, opts: AddEventListenerOptions = { capture: true, passive: true }) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(document, "click", (e: MouseEvent) => this.onClick(e));
    on(document, "mousemove", (e: MouseEvent) => this.onMove(e));
    on(document, "mouseover", (e: MouseEvent) => this.onOver(e));
    on(document, "mouseout", (e: MouseEvent) => this.onOut(e));
    on(document, "copy", () => this.onCopy());
    on(window, "scroll", () => this.measure());
    on(window, "pagehide", () => void this.flush(true));
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush(true);
      else this.lastTick = Date.now();
    });
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        this.lastMutation = Date.now();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      this.cleanups.push(() => observer.disconnect());
    }
    this.lastTick = Date.now();
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => void this.flush(false), this.opts.flushInterval));
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const c of this.cleanups) c();
    this.cleanups = [];
    await this.flush(true);
    this.state = null;
  }

  /** Ends the current page view and starts a new one (route change). */
  newPageView(): void {
    if (!this.cleanups.length) return;
    if (this.state && pathOf(this.state.url) === window.location.pathname) return;
    void this.flush(true);
    this.open();
  }

  private open(): void {
    this.sampled = Math.random() < Math.max(0, Math.min(1, this.opts.sampleRate));
    const url = window.location.href;
    let page: string | undefined;
    if (this.opts.pageName) {
      try {
        page = this.opts.pageName(new URL(url));
      } catch {
        page = undefined;
      }
    }
    this.state = {
      id: randomId(),
      url,
      page,
      startedAt: Date.now(),
      items: [],
      moves: new Map(),
      attention: new Array(BANDS).fill(0),
      maxBottom: 0,
      visibleMs: 0,
      exitSent: false,
      dirty: true,
    };
    this.recent = [];
    this.hover = null;
    this.measure();
  }

  private ignored(el: Element | null): boolean {
    if (!el) return true;
    if (el.closest("[data-iforevents-ignore]")) return true;
    if (this.opts.ignore) {
      try {
        if (el.closest(this.opts.ignore)) return true;
      } catch {
        /* an invalid selector ignores nothing */
      }
    }
    return false;
  }

  private push(item: HeatmapItem): void {
    const s = this.state;
    if (!s || !this.sampled || s.items.length >= MAX_ITEMS) return;
    item.t = Date.now() - s.startedAt;
    s.items.push(item);
    s.dirty = true;
  }

  private point(e: MouseEvent): { x: number; y: number } {
    return { x: Math.max(0, Math.min(10000, Math.round((e.pageX / docWidth()) * 10000))), y: Math.max(0, Math.round(e.pageY)) };
  }

  private describe(el: Element): Pick<HeatmapItem, "s" | "tag" | "txt"> {
    const out: Pick<HeatmapItem, "s" | "tag" | "txt"> = { s: selectorOf(el), tag: el.tagName.toLowerCase() };
    if (!this.opts.maskText) {
      const txt = elementText(el);
      if (txt) out.txt = txt;
    }
    return out;
  }

  private onClick(e: MouseEvent): void {
    if (!this.active) return;
    const raw = e.target instanceof Element ? e.target : null;
    if (this.ignored(raw)) return;
    const target = (raw!.closest(INTERACTIVE) as Element | null) || raw!;
    const p = this.point(e);
    const desc = this.describe(target);
    this.push({ k: "click", ...p, ...desc });
    if (this.hover && this.hover.el === target) this.hover.clicked = true;

    // Rage: RAGE_CLICKS or more within RAGE_WINDOW_MS on one spot, one
    // row per burst.
    const now = Date.now();
    this.recent = this.recent.filter((c) => now - c.t <= RAGE_WINDOW_MS);
    this.recent.push({ t: now, x: e.clientX, y: e.clientY });
    const near = this.recent.filter((c) => Math.hypot(c.x - e.clientX, c.y - e.clientY) <= RAGE_RADIUS_PX);
    if (near.length >= RAGE_CLICKS && now > this.rageUntil) {
      this.push({ k: "rage_click", ...p, v: near.length, ...desc });
      this.rageUntil = now + RAGE_WINDOW_MS;
    }

    // Dead: nothing changed on the page and the address stayed the same
    // for a second after the click. Links, fields and labels react in
    // ways a page cannot see (a new tab, the keyboard), so they never
    // count.
    if (target.closest("a[href],input,select,textarea,label,option,[contenteditable]")) return;
    const url = window.location.href;
    const clickedAt = now;
    const scrollY = window.scrollY;
    setTimeout(() => {
      if (!this.active) return;
      if (this.lastMutation >= clickedAt || window.location.href !== url || Math.abs(window.scrollY - scrollY) > 4) return;
      const selection = typeof window.getSelection === "function" ? String(window.getSelection() || "") : "";
      if (selection) return;
      this.push({ k: "dead_click", ...p, ...desc });
    }, DEAD_WAIT_MS);
  }

  private onMove(e: MouseEvent): void {
    if (!this.active || !this.opts.mouseMove) return;
    const now = Date.now();
    if (now - this.lastMove < MOVE_THROTTLE_MS) return;
    this.lastMove = now;
    const s = this.state!;
    const p = this.point(e);
    const key = Math.floor(p.x / MOVE_CELL_W) * MOVE_CELL_W + ":" + Math.floor(p.y / MOVE_CELL_H) * MOVE_CELL_H;
    const n = s.moves.get(key);
    if (n === undefined && s.moves.size >= MAX_MOVE_CELLS) return;
    s.moves.set(key, (n ?? 0) + 1);
    s.dirty = true;
  }

  private onOver(e: MouseEvent): void {
    if (!this.active) return;
    const raw = e.target instanceof Element ? e.target : null;
    if (!raw || this.ignored(raw)) return;
    const el = raw.closest(INTERACTIVE);
    if (!el || (this.hover && this.hover.el === el)) return;
    this.endHover();
    const p = this.point(e);
    this.hover = { el, since: Date.now(), x: p.x, y: p.y, clicked: false };
  }

  private onOut(e: MouseEvent): void {
    if (!this.active) return;
    // Exit intent: the pointer leaves the window through the top edge.
    if (!e.relatedTarget && e.clientY <= 0 && !this.state!.exitSent) {
      this.state!.exitSent = true;
      this.push({ k: "exit_intent", ...this.point(e) });
    }
    if (this.hover && e.target instanceof Element) {
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (!to || !this.hover.el.contains(to)) this.endHover();
    }
  }

  private endHover(): void {
    const h = this.hover;
    this.hover = null;
    if (!h || h.clicked || !this.active) return;
    const ms = Date.now() - h.since;
    if (ms >= HESITATION_MS && ms < 60_000 && document.contains(h.el)) {
      this.push({ k: "hesitation", x: h.x, y: h.y, v: ms, ...this.describe(h.el) });
    }
  }

  private onCopy(): void {
    if (!this.active) return;
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    const anchor = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement) : null;
    if (anchor && this.ignored(anchor)) return;
    const item: HeatmapItem = { k: "copy", x: 0, y: 0 };
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      item.x = Math.max(0, Math.min(10000, Math.round(((r.left + window.scrollX) / docWidth()) * 10000)));
      item.y = Math.max(0, Math.round(r.top + window.scrollY));
      item.s = selectorOf(anchor);
      item.tag = anchor.tagName.toLowerCase();
    }
    if (!this.opts.maskText) {
      const text = clean(String(sel || ""));
      if (text) item.txt = text;
    }
    this.push(item);
  }

  private measure(): void {
    const s = this.state;
    if (!s) return;
    const bottom = Math.round(window.scrollY + window.innerHeight);
    if (bottom > s.maxBottom) {
      s.maxBottom = bottom;
      s.dirty = true;
    }
  }

  // Every TICK_MS while the page is visible: time on page, and time on
  // screen for every 5% band at least half visible.
  private tick(): void {
    const s = this.state;
    const now = Date.now();
    const elapsed = Math.min(now - this.lastTick, 5 * TICK_MS);
    this.lastTick = now;
    // A single-page app changed route without a reload: a new page view.
    if (s && pathOf(s.url) !== window.location.pathname) {
      this.newPageView();
      return;
    }
    if (!s || !this.sampled || document.visibilityState === "hidden") return;
    s.visibleMs += elapsed;
    this.measure();
    const h = docHeight();
    const top = window.scrollY;
    const bottom = top + window.innerHeight;
    const band = h / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const from = i * band;
      const to = from + band;
      const seen = Math.min(to, bottom) - Math.max(from, top);
      if (seen >= band / 2) s.attention[i] = (s.attention[i] ?? 0) + elapsed;
    }
    s.dirty = true;
  }

  /** Sends what the current page view recorded since the last send. */
  async flush(keepalive = false): Promise<void> {
    const s = this.state;
    if (!s || !this.sampled || this.sending || !s.dirty) return;
    if (keepalive) this.endHover();
    const items = s.items.splice(0, s.items.length);
    for (const [key, n] of s.moves) {
      const [x, y] = key.split(":").map(Number);
      items.push({ k: "move", x: x!, y: y!, n });
    }
    s.moves.clear();
    s.attention.forEach((ms, i) => {
      if (ms > 0) items.push({ k: "attention", x: 0, y: i, v: Math.round(ms) });
    });
    s.attention.fill(0);
    items.push({ k: "scroll", x: 0, y: s.maxBottom, v: Math.round(s.visibleMs) });
    s.dirty = false;
    const payload: HeatmapPayload = {
      page_view_id: s.id,
      url: s.url,
      platform: "web",
      viewport: { w: window.innerWidth, h: window.innerHeight },
      document: { w: docWidth(), h: docHeight() },
      created_at: new Date(s.startedAt).toISOString(),
      items,
    };
    if (s.page) payload.page = s.page;
    this.sending = true;
    try {
      await this.send(payload, keepalive);
    } catch {
      // A heatmap is a sample: what failed to send is dropped, never
      // retried into a later page view.
    } finally {
      this.sending = false;
    }
  }
}
