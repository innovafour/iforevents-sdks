import type { IntegrationResult, PageOptions, Properties } from "@iforevents/core";
import { createBrowserIforevents, type BrowserIforevents, type BrowserIforeventsOptions, type QueuedCall } from "./browser";

/**
 * Static, script-tag friendly facade (same surface as the original
 * `iforevents.min.js` snippet): `Iforevents.init(projectKey, options)`, then
 * `track`, `page`, `identify`, `reset`, `flush`. Calls made before `init`
 * through `window.iforevents.push([...])` are replayed in order.
 */
export class IforeventsStatic {
  static readonly version = "0.1.0";
  private static client: BrowserIforevents | null = null;

  static init(projectKey: string, options: BrowserIforeventsOptions = {}): BrowserIforevents {
    if (!IforeventsStatic.client) {
      if (!projectKey) throw new Error("[iforevents] init needs the project key");
      IforeventsStatic.client = createBrowserIforevents(projectKey, options);
      IforeventsStatic.drainQueue();
    }
    return IforeventsStatic.client;
  }

  static get instance(): BrowserIforevents | null {
    return IforeventsStatic.client;
  }

  static track(name: string, properties?: Properties): Promise<IntegrationResult[]> {
    return IforeventsStatic.need("track").track(name, properties);
  }
  static page(nameOrProperties?: string | Properties, properties?: Properties, options?: PageOptions): Promise<IntegrationResult[]> {
    return IforeventsStatic.need("page").page(nameOrProperties, properties, options);
  }
  static identify(customId: string, traits?: Properties): Promise<IntegrationResult[]> {
    return IforeventsStatic.need("identify").identify(customId, traits);
  }
  static reset(): Promise<IntegrationResult[]> {
    return IforeventsStatic.need("reset").reset();
  }
  static flush(): Promise<IntegrationResult[]> {
    return IforeventsStatic.client ? IforeventsStatic.client.flush() : Promise.resolve([]);
  }

  /** Replays `window.iforevents` (an array of `[method, ...args]`) and turns it into a live proxy. */
  static drainQueue(): void {
    if (typeof window === "undefined") return;
    const w = window as unknown as { iforevents?: QueuedCall[] | { push(call: QueuedCall): void } };
    const pending = Array.isArray(w.iforevents) ? w.iforevents : [];
    // Replay strictly in order so an identify lands before the tracks after it.
    let chain: Promise<unknown> = Promise.resolve();
    const apply = (call: QueuedCall): void => {
      const [method, ...args] = call;
      const fn = (IforeventsStatic as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") return;
      chain = chain
        .then(() => (fn as (...a: unknown[]) => unknown).apply(IforeventsStatic, args))
        .catch((error: unknown) => console.warn("[iforevents] queued call failed", method, error));
    };
    w.iforevents = { push: apply };
    for (const call of pending) apply(call);
  }

  /** Test hook: forget the client so `init` creates a new one. */
  static async _resetForTests(): Promise<void> {
    await IforeventsStatic.client?.shutdown();
    IforeventsStatic.client = null;
  }

  private static need(method: string): BrowserIforevents {
    if (!IforeventsStatic.client) throw new Error(`[iforevents] call init before ${method}`);
    return IforeventsStatic.client;
  }
}
