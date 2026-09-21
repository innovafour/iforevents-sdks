import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor, scalarize } from "./_vendor";

/** The slice of the `mixpanel` (Node) package this adapter calls. */
export interface MixpanelNodeClient {
  track(name: string, properties: Record<string, unknown>, callback?: (err?: Error) => void): void;
  people: { set(distinctId: string, properties: Record<string, unknown>, callback?: (err?: Error) => void): void };
}

export interface MixpanelNodeIntegrationOptions extends IntegrationHooks {
  token?: string;
  /** Extra `Mixpanel.init` config (host, protocol, ...). */
  config?: Record<string, unknown>;
  client?: MixpanelNodeClient;
}

/**
 * Server-side Mixpanel. The distinct id is the last identified customId;
 * anonymous events use `anonymousId` when set.
 */
export class MixpanelIntegration extends Integration {
  private client: MixpanelNodeClient | null;
  private distinctId: string | null = null;
  private readonly options: MixpanelNodeIntegrationOptions;

  constructor(options: MixpanelNodeIntegrationOptions) {
    super(options, "MixpanelIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.token) throw new Error("[iforevents] MixpanelIntegration needs a token or a client");
      const Mixpanel = await loadVendor<{ init(token: string, config?: Record<string, unknown>): MixpanelNodeClient }>("mixpanel");
      this.client = Mixpanel.init(this.options.token, this.options.config);
    }
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.distinctId = event.customId;
    await this.call((cb) => this.client?.people.set(event.customId, scalarize(event.traits), cb));
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    const props: Record<string, unknown> = { ...scalarize(event.properties), time: Math.floor(event.timestamp.getTime() / 1000) };
    if (this.distinctId) props.distinct_id = this.distinctId;
    await this.call((cb) => this.client?.track(event.name, props, cb));
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    await this.track({ name: event.name || "page_view", type: "page_view", properties: { ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }, timestamp: event.timestamp });
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.distinctId = null;
  }

  private call(fn: (cb: (err?: Error) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));
  }
}
