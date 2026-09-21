import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor, scalarize } from "./_vendor";

/** The slice of `@amplitude/analytics-node` this adapter calls. */
export interface AmplitudeNodeClient {
  init(apiKey: string, options?: Record<string, unknown>): { promise: Promise<unknown> } | unknown;
  identify(identify: { set(key: string, value: string | number | boolean): unknown }, eventOptions: { user_id?: string; device_id?: string }): unknown;
  track(name: string, properties: Record<string, unknown> | undefined, eventOptions: { user_id?: string; device_id?: string; time?: number }): unknown;
  flush(): { promise: Promise<unknown> } | unknown;
  Identify: new () => { set(key: string, value: string | number | boolean): unknown };
}

export interface AmplitudeNodeIntegrationOptions extends IntegrationHooks {
  apiKey?: string;
  config?: Record<string, unknown>;
  client?: AmplitudeNodeClient;
  /** Device id used for anonymous events. Default `server`. */
  deviceId?: string;
}

/** Server-side Amplitude; the user id is the last identified customId. */
export class AmplitudeIntegration extends Integration {
  private client: AmplitudeNodeClient | null;
  private userId: string | null = null;
  private readonly options: AmplitudeNodeIntegrationOptions;

  constructor(options: AmplitudeNodeIntegrationOptions) {
    super(options, "AmplitudeIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.apiKey) throw new Error("[iforevents] AmplitudeIntegration needs an apiKey or a client");
      this.client = await loadVendor<AmplitudeNodeClient>("@amplitude/analytics-node", (m) => m as unknown as AmplitudeNodeClient);
      const r = this.client.init(this.options.apiKey, this.options.config) as { promise?: Promise<unknown> } | undefined;
      await r?.promise;
    }
  }

  private target(): { user_id?: string; device_id?: string } {
    return this.userId ? { user_id: this.userId } : { device_id: this.options.deviceId ?? "server" };
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    if (!this.client) return;
    this.userId = event.customId;
    const id = new this.client.Identify();
    for (const [k, v] of Object.entries(scalarize(event.traits))) id.set(k, v);
    await this.client.identify(id, { user_id: event.customId });
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    await this.client?.track(event.name, scalarize(event.properties), { ...this.target(), time: event.timestamp.getTime() });
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    await this.track({ name: event.name || "page_view", type: "page_view", properties: { ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }, timestamp: event.timestamp });
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.userId = null;
  }

  override async flush(): Promise<void> {
    const r = this.client?.flush() as { promise?: Promise<unknown> } | undefined;
    await r?.promise;
  }

  override async shutdown(): Promise<void> {
    await this.flush();
  }
}
