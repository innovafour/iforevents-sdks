import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor } from "./_vendor";

/** The slice of `posthog-js` this adapter calls. */
export interface PostHogBrowserClient {
  init(apiKey: string, config?: Record<string, unknown>): unknown;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): unknown;
  reset(): void;
}

export interface PostHogIntegrationOptions extends IntegrationHooks {
  apiKey?: string;
  /** Extra `posthog.init` config; `api_host` defaults to https://us.i.posthog.com. Autocapture and pageview capture are off unless you enable them. */
  config?: Record<string, unknown>;
  client?: PostHogBrowserClient;
}

/** Forwards identify/track/page/reset to PostHog in the browser. */
export class PostHogIntegration extends Integration {
  private client: PostHogBrowserClient | null;
  private readonly options: PostHogIntegrationOptions;

  constructor(options: PostHogIntegrationOptions) {
    super(options, "PostHogIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.apiKey) throw new Error("[iforevents] PostHogIntegration needs an apiKey or a client");
      this.client = await loadVendor<PostHogBrowserClient>("posthog-js", (m) => (m.posthog ?? m.default ?? m) as PostHogBrowserClient);
      this.client.init(this.options.apiKey, { api_host: "https://us.i.posthog.com", autocapture: false, capture_pageview: false, ...this.options.config });
    }
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.client?.identify(event.customId, event.traits);
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    this.client?.capture(event.name, event.properties);
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    this.client?.capture("$pageview", { ...event.properties, screen_name: event.name, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute });
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.client?.reset();
  }
}
