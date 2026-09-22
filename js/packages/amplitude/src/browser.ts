import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { loadVendor, scalarize } from "./_vendor";

/** The slice of `@amplitude/analytics-browser` this adapter calls. */
export interface AmplitudeBrowserClient {
  init(apiKey: string, options?: Record<string, unknown>): { promise: Promise<unknown> } | unknown;
  setUserId(userId: string | undefined): void;
  identify(identify: AmplitudeIdentifyBuilder): unknown;
  track(name: string, properties?: Record<string, unknown>): unknown;
  reset(): void;
  Identify: new () => AmplitudeIdentifyBuilder;
}
export interface AmplitudeIdentifyBuilder {
  set(key: string, value: string | number | boolean): AmplitudeIdentifyBuilder;
}

export interface AmplitudeIntegrationOptions extends IntegrationHooks {
  apiKey?: string;
  /** Extra `init` options (serverUrl, autocapture, ...). Autocapture is off unless you enable it. */
  config?: Record<string, unknown>;
  client?: AmplitudeBrowserClient;
}

/** Forwards identify/track/page/reset to Amplitude in the browser. Mirrors `iforevents_amplitude`. */
export class AmplitudeIntegration extends Integration {
  private client: AmplitudeBrowserClient | null;
  private readonly options: AmplitudeIntegrationOptions;

  constructor(options: AmplitudeIntegrationOptions) {
    super(options, "AmplitudeIntegration");
    this.options = options;
    this.client = options.client ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.client) {
      if (!this.options.apiKey) throw new Error("[iforevents] AmplitudeIntegration needs an apiKey or a client");
      this.client = await loadVendor<AmplitudeBrowserClient>("@amplitude/analytics-browser", (m) => m as unknown as AmplitudeBrowserClient);
      const r = this.client.init(this.options.apiKey, { autocapture: false, ...this.options.config }) as { promise?: Promise<unknown> } | undefined;
      await r?.promise;
    }
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    if (!this.client) return;
    this.client.setUserId(event.customId);
    const id = new this.client.Identify();
    for (const [k, v] of Object.entries(scalarize(event.traits))) id.set(k, v);
    await this.client.identify(id);
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    await this.client?.track(event.name, scalarize(event.properties));
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    await this.client?.track(event.name || "page_view", scalarize({ ...event.properties, navigation_type: event.navigationType, to_route: event.toRoute, previous_route: event.previousRoute }));
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.client?.reset();
  }
}
