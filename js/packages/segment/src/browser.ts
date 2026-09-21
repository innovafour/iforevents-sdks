import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor } from "./_vendor";

/** The slice of `@segment/analytics-next`'s `AnalyticsBrowser` this adapter calls. */
export interface SegmentBrowserClient {
  identify(userId: string, traits?: Record<string, unknown>): unknown;
  track(event: string, properties?: Record<string, unknown>): unknown;
  page(category?: string, name?: string, properties?: Record<string, unknown>): unknown;
  reset(): unknown;
}

export interface SegmentIntegrationOptions extends IntegrationHooks {
  writeKey?: string;
  /** Extra `AnalyticsBrowser.load` settings (cdnURL, ...). */
  config?: Record<string, unknown>;
  client?: SegmentBrowserClient;
}

/** Forwards identify/track/page/reset to Segment in the browser. Mirrors `iforevents_segment`. */
export class SegmentIntegration extends Integration {
  private client: SegmentBrowserClient | null;
  private readonly options: SegmentIntegrationOptions;

  constructor(options: SegmentIntegrationOptions) {
    super(options, "SegmentIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.writeKey) throw new Error("[iforevents] SegmentIntegration needs a writeKey or a client");
      const { AnalyticsBrowser } = await loadVendor<{ AnalyticsBrowser: { load(settings: Record<string, unknown>): SegmentBrowserClient } }>("@segment/analytics-next", (m) => m as never);
      this.client = AnalyticsBrowser.load({ writeKey: this.options.writeKey, ...this.options.config });
    }
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    await this.client?.identify(event.customId, event.traits);
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    await this.client?.track(event.name, event.properties);
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    await this.client?.page(undefined, event.name === "page_view" ? undefined : event.name, { ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute });
  }

  override async reset(): Promise<void> {
    await super.reset();
    await this.client?.reset();
  }
}
