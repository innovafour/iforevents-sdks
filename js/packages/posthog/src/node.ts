import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor } from "./_vendor";

/** The slice of `posthog-node`'s `PostHog` this adapter calls. */
export interface PostHogNodeClient {
  identify(message: { distinctId: string; properties?: Record<string, unknown> }): void;
  capture(message: { distinctId: string; event: string; properties?: Record<string, unknown>; timestamp?: Date }): void;
  flush?(): Promise<unknown>;
  shutdown?(): Promise<unknown>;
}

export interface PostHogNodeIntegrationOptions extends IntegrationHooks {
  apiKey?: string;
  /** `PostHog` constructor options; `host` defaults to https://us.i.posthog.com. */
  config?: Record<string, unknown>;
  client?: PostHogNodeClient;
  /** Distinct id for events before identify. Default `server`. */
  anonymousId?: string;
}

/** Server-side PostHog; the distinct id is the last identified customId. */
export class PostHogIntegration extends Integration {
  private client: PostHogNodeClient | null;
  private distinctId: string | null = null;
  private readonly options: PostHogNodeIntegrationOptions;

  constructor(options: PostHogNodeIntegrationOptions) {
    super(options, "PostHogIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.apiKey) throw new Error("[iforevents] PostHogIntegration needs an apiKey or a client");
      const { PostHog } = await loadVendor<{ PostHog: new (apiKey: string, options?: Record<string, unknown>) => PostHogNodeClient }>("posthog-node", (m) => m as never);
      this.client = new PostHog(this.options.apiKey, { host: "https://us.i.posthog.com", ...this.options.config });
    }
  }

  private who(): string {
    return this.distinctId ?? this.options.anonymousId ?? "server";
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.distinctId = event.customId;
    this.client?.identify({ distinctId: event.customId, properties: event.traits });
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    this.client?.capture({ distinctId: this.who(), event: event.name, properties: event.properties, timestamp: event.timestamp });
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    this.client?.capture({ distinctId: this.who(), event: "$pageview", properties: { ...event.properties, screen_name: event.name, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }, timestamp: event.timestamp });
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.distinctId = null;
  }

  override async flush(): Promise<void> {
    await this.client?.flush?.();
  }

  override async shutdown(): Promise<void> {
    if (this.client?.shutdown) await this.client.shutdown();
    else await this.flush();
  }
}
