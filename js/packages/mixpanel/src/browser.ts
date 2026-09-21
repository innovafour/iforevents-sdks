import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor, scalarize } from "./_vendor";

/** The slice of `mixpanel-browser` this adapter calls. */
export interface MixpanelBrowserClient {
  init(token: string, config?: Record<string, unknown>): unknown;
  identify(id: string): void;
  alias?(alias: string, original?: string): void;
  track(name: string, properties?: Record<string, unknown>): void;
  reset(): void;
  register?(properties: Record<string, unknown>): void;
  people: { set(properties: Record<string, unknown>): void };
}

export interface MixpanelIntegrationOptions extends IntegrationHooks {
  /** Mixpanel project token. Ignored when `client` is given. */
  token?: string;
  /** Extra `mixpanel.init` config (api_host, persistence, ...). */
  config?: Record<string, unknown>;
  /** An already-initialized client (tests, custom bundling). */
  client?: MixpanelBrowserClient;
}

/** Forwards identify/track/page/reset to Mixpanel in the browser. Mirrors `iforevents_mixpanel`. */
export class MixpanelIntegration extends Integration {
  private client: MixpanelBrowserClient | null;
  private readonly options: MixpanelIntegrationOptions;

  constructor(options: MixpanelIntegrationOptions) {
    super(options, "MixpanelIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.token) throw new Error("[iforevents] MixpanelIntegration needs a token or a client");
      this.client = await loadVendor<MixpanelBrowserClient>("mixpanel-browser");
      this.client.init(this.options.token, { track_pageview: false, ...this.options.config });
    }
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.client?.identify(event.customId);
    this.client?.people.set(scalarize(event.traits));
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    this.client?.track(event.name, scalarize(event.properties));
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    this.client?.track(event.name || "page_view", scalarize({ ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }));
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.client?.reset();
  }
}
