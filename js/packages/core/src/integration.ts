import type { IdentifyEvent, IntegrationResult, PageEvent, TrackEvent } from "./types";

/** Optional callbacks fired before an integration handles a call. */
export interface IntegrationHooks {
  onInit?: () => void;
  onIdentify?: (event: IdentifyEvent) => void;
  onTrack?: (event: TrackEvent) => void;
  onPage?: (event: PageEvent) => void;
  onReset?: () => void;
}

/**
 * Base class every integration extends. Override what the vendor supports and
 * call `super` first so the hooks run, exactly like the Flutter package.
 */
export class Integration {
  /** Name used in results and logs; defaults to the class name. */
  readonly name: string;
  protected readonly hooks: IntegrationHooks;

  constructor(hooks: IntegrationHooks = {}, name?: string) {
    this.hooks = hooks;
    this.name = name ?? new.target.name ?? "Integration";
  }

  async init(): Promise<void> {
    this.hooks.onInit?.();
  }

  async identify(event: IdentifyEvent): Promise<void> {
    this.hooks.onIdentify?.(event);
  }

  async track(event: TrackEvent): Promise<void> {
    this.hooks.onTrack?.(event);
  }

  async page(event: PageEvent): Promise<void> {
    this.hooks.onPage?.(event);
  }

  async reset(): Promise<void> {
    this.hooks.onReset?.();
  }

  /** Sends anything buffered. No-op by default. */
  async flush(): Promise<void> {}

  /** Flushes and releases timers or sockets. No-op by default. */
  async shutdown(): Promise<void> {}
}

/** Runs one integration call in isolation and reports the outcome. */
export async function safeExecute(integration: Integration, action: () => Promise<void> | void): Promise<IntegrationResult> {
  try {
    await action();
    return { integration: integration.name, success: true, timestamp: new Date() };
  } catch (error) {
    return { integration: integration.name, success: false, error, timestamp: new Date() };
  }
}
