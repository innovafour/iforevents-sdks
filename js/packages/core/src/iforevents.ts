import { defaultContext } from "./context";
import { flatten } from "./flatten";
import { Integration, safeExecute } from "./integration";
import type { ContextProvider, IntegrationResult, Logger, PageEvent, Properties } from "./types";

export interface IforeventsOptions {
  /** Integrations to fan every call out to, in order. */
  integrations?: Integration[];
  /** Platform context merged into identify traits (device, sdk, runtime). */
  context?: ContextProvider;
  /** Log integration failures. Default false. */
  debug?: boolean;
  logger?: Logger;
  /** Observe the outcome of every fan-out (for retries, metrics, tests). */
  onResult?: (results: IntegrationResult[]) => void;
}

export interface PageOptions {
  navigationType?: string;
  toRoute?: string;
  previousRoute?: string;
}

/**
 * The facade: one `init`, then `identify`, `track`, `page`, `reset`, `flush`
 * and `shutdown` fan out to every integration in isolation. Identify traits
 * are remembered and merged under later track properties; nested objects are
 * flattened with `_`. Mirrors the `Iforevents` class of the Flutter package.
 */
export class Iforevents {
  private integrations: Integration[] = [];
  private traits: Properties = {};
  private initialized = false;
  private contextProvider: ContextProvider;
  private readonly logger: Logger | null;
  private readonly onResult?: (results: IntegrationResult[]) => void;

  constructor(options: IforeventsOptions = {}) {
    this.integrations = [...(options.integrations ?? [])];
    this.contextProvider = options.context ?? defaultContext;
    this.logger = options.debug ? (options.logger ?? console) : null;
    this.onResult = options.onResult;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Traits remembered from the last identify (context included). */
  get currentTraits(): Properties {
    return { ...this.traits };
  }

  /** Registers an integration; call `init` (or `initIntegration`) afterwards. */
  addIntegration(integration: Integration): this {
    this.integrations.push(integration);
    return this;
  }

  /** Finds a registered integration by name or class. */
  getIntegration<T extends Integration>(match: string | (new (...args: never[]) => T)): T | undefined {
    return this.integrations.find((i) => (typeof match === "string" ? i.name === match : i instanceof match)) as T | undefined;
  }

  /** Initializes every integration. Failures are reported, never thrown. */
  async init(options: Pick<IforeventsOptions, "integrations" | "context"> = {}): Promise<IntegrationResult[]> {
    if (options.integrations) this.integrations.push(...options.integrations);
    if (options.context) this.contextProvider = options.context;
    const results = await this.fanOut((i) => i.init());
    this.initialized = true;
    return results;
  }

  async identify(customId: string, traits: Properties = {}): Promise<IntegrationResult[]> {
    if (!customId) return [];
    if (!this.ready("identify")) return [];
    const context = await this.safeContext();
    const merged = flatten({ ...context, ...traits });
    const results = await this.fanOut((i) => i.identify({ customId, traits: merged }));
    this.traits = merged;
    return results;
  }

  async track(name: string, properties: Properties = {}): Promise<IntegrationResult[]> {
    if (!name) return [];
    if (!this.ready("track")) return [];
    const merged = flatten({ ...this.traits, ...properties });
    const timestamp = new Date();
    return this.fanOut((i) => i.track({ name, type: "track", properties: merged, timestamp }));
  }

  async page(name?: string, properties: Properties = {}, options: PageOptions = {}): Promise<IntegrationResult[]> {
    if (!this.ready("page")) return [];
    const event: PageEvent = { name: name || "page_view", properties: flatten(properties), timestamp: new Date(), ...options };
    return this.fanOut((i) => i.page(event));
  }

  /** Alias of `page` for mobile-style naming. */
  screen(name?: string, properties: Properties = {}, options: PageOptions = {}): Promise<IntegrationResult[]> {
    return this.page(name, properties, options);
  }

  /** Forgets the user in every integration (logout). */
  async reset(): Promise<IntegrationResult[]> {
    if (!this.ready("reset")) return [];
    const results = await this.fanOut((i) => i.reset());
    this.traits = {};
    return results;
  }

  async flush(): Promise<IntegrationResult[]> {
    return this.fanOut((i) => i.flush());
  }

  /** Flushes and releases every integration; the instance is no longer usable. */
  async shutdown(): Promise<IntegrationResult[]> {
    const results = await this.fanOut((i) => i.shutdown());
    this.initialized = false;
    return results;
  }

  private ready(method: string): boolean {
    if (this.initialized) return true;
    this.logger?.warn(`[iforevents] ${method} called before init; ignored`);
    return false;
  }

  private async safeContext(): Promise<Properties> {
    try {
      return (await this.contextProvider()) ?? {};
    } catch (error) {
      this.logger?.warn("[iforevents] context provider failed", error);
      return {};
    }
  }

  private async fanOut(action: (integration: Integration) => Promise<void> | void): Promise<IntegrationResult[]> {
    const results = await Promise.all(this.integrations.map((integration) => safeExecute(integration, () => action(integration))));
    for (const result of results) {
      if (!result.success) this.logger?.warn(`[iforevents] ${result.integration} failed`, result.error);
    }
    this.onResult?.(results);
    return results;
  }
}
