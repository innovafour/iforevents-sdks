import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor } from "./_vendor";

/** The slice of `@segment/analytics-node`'s `Analytics` this adapter calls. */
export interface SegmentNodeClient {
  identify(message: { userId?: string; anonymousId?: string; traits?: Record<string, unknown> }): unknown;
  track(message: { userId?: string; anonymousId?: string; event: string; properties?: Record<string, unknown>; timestamp?: Date }): unknown;
  page(message: { userId?: string; anonymousId?: string; name?: string; properties?: Record<string, unknown>; timestamp?: Date }): unknown;
  flush?(): Promise<unknown>;
  closeAndFlush?(): Promise<unknown>;
}

export interface SegmentNodeIntegrationOptions extends IntegrationHooks {
  writeKey?: string;
  config?: Record<string, unknown>;
  client?: SegmentNodeClient;
  /** Anonymous id for events before identify. Default `server`. */
  anonymousId?: string;
}

/** Server-side Segment; the user id is the last identified customId. */
export class SegmentIntegration extends Integration {
  private client: SegmentNodeClient | null;
  private userId: string | null = null;
  private readonly options: SegmentNodeIntegrationOptions;

  constructor(options: SegmentNodeIntegrationOptions) {
    super(options, "SegmentIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.writeKey) throw new Error("[iforevents] SegmentIntegration needs a writeKey or a client");
      const { Analytics } = await loadVendor<{ Analytics: new (settings: Record<string, unknown>) => SegmentNodeClient }>("@segment/analytics-node", (m) => m as never);
      this.client = new Analytics({ writeKey: this.options.writeKey, ...this.options.config });
    }
  }

  private who(): { userId?: string; anonymousId?: string } {
    return this.userId ? { userId: this.userId } : { anonymousId: this.options.anonymousId ?? "server" };
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.userId = event.customId;
    await this.client?.identify({ userId: event.customId, traits: event.traits });
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    await this.client?.track({ ...this.who(), event: event.name, properties: event.properties, timestamp: event.timestamp });
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    await this.client?.page({ ...this.who(), name: event.name, properties: { ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }, timestamp: event.timestamp });
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.userId = null;
  }

  override async flush(): Promise<void> {
    await this.client?.flush?.();
  }

  override async shutdown(): Promise<void> {
    if (this.client?.closeAndFlush) await this.client.closeAndFlush();
    else await this.flush();
  }
}
