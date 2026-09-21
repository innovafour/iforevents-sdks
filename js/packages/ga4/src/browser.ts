import { Integration, type IdentifyEvent, type IntegrationHooks, type PageEvent, type TrackEvent } from "@iforevents/core";
import { scalarize } from "./_vendor";

export type Gtag = (...args: unknown[]) => void;

export interface GA4IntegrationOptions extends IntegrationHooks {
  /** Measurement id (`G-XXXXXXX`). Loads gtag.js when no `gtag` is on the page. */
  measurementId: string;
  /** Use an existing `gtag` function instead of `window.gtag`. */
  gtag?: Gtag;
  /** Inject the gtag.js script tag when missing. Default true. */
  loadScript?: boolean;
  /** Extra `config` parameters (send_page_view is false by default so IForevents drives page views). */
  config?: Record<string, unknown>;
}

/** Forwards identify/track/page to Google Analytics 4 through gtag.js. Mirrors `iforevents_firebase` for the web. */
export class GA4Integration extends Integration {
  private gtag: Gtag | null;
  private readonly options: GA4IntegrationOptions;

  constructor(options: GA4IntegrationOptions) {
    super(options, "GA4Integration");
    this.options = options;
    this.gtag = options.gtag ?? null;
  }

  override async init(): Promise<void> {
    await super.init();
    if (!this.gtag) {
      if (typeof window === "undefined") throw new Error("[iforevents] GA4Integration runs in browsers only");
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: Gtag };
      w.dataLayer = w.dataLayer ?? [];
      if (typeof w.gtag !== "function") {
        w.gtag = function gtag() {
          // gtag.js reads `arguments`, not a spread array.
          // eslint-disable-next-line prefer-rest-params
          w.dataLayer!.push(arguments);
        };
        if (this.options.loadScript !== false) {
          const s = document.createElement("script");
          s.async = true;
          s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(this.options.measurementId)}`;
          document.head.appendChild(s);
        }
      }
      this.gtag = w.gtag;
      this.gtag("js", new Date());
    }
    this.gtag("config", this.options.measurementId, { send_page_view: false, ...this.options.config });
  }

  override async identify(event: IdentifyEvent): Promise<void> {
    await super.identify(event);
    this.gtag?.("config", this.options.measurementId, { user_id: event.customId, send_page_view: false });
    this.gtag?.("set", "user_properties", scalarize(event.traits));
  }

  override async track(event: TrackEvent): Promise<void> {
    await super.track(event);
    this.gtag?.("event", event.name, scalarize(event.properties));
  }

  override async page(event: PageEvent): Promise<void> {
    await super.page(event);
    this.gtag?.("event", "page_view", scalarize({ page_title: event.name, page_path: event.toRoute, ...event.properties }));
  }

  override async reset(): Promise<void> {
    await super.reset();
    this.gtag?.("config", this.options.measurementId, { user_id: null, send_page_view: false });
  }
}
