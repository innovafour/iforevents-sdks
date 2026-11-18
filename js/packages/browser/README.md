# @iforevents/browser

IForevents analytics for the web. Automatic page views, an offline queue in
`localStorage`, a beacon flush when the tab closes, and pluggable adapters
(Mixpanel, GA4, Segment, PostHog, Amplitude). Built on `@iforevents/core`.

> The SDK takes the **project key** only. It is a public write key made to
> ship in browsers: it grants event ingestion and nothing else.

## Bundlers

```bash
npm install @iforevents/browser
```

```ts
import { createBrowserIforevents } from "@iforevents/browser";

const analytics = createBrowserIforevents("pk_...", { autoTrack: true });
await analytics.identify("user_123", { email: "ada@example.com", plan: "pro" });
await analytics.track("signup_clicked", { plan: "pro" });
await analytics.page("/pricing");
```

## Script tag

```html
<script src="https://iforevents.com/sdk/v1/iforevents.min.js" async
        data-project-key="pk_..." data-auto-track="true"></script>
<script>
  window.iforevents = window.iforevents || [];
  window.iforevents.push(["identify", "user_123", { plan: "pro" }]);
  window.iforevents.push(["track", "signup_clicked"]);
</script>
```

Or after the script loaded: `Iforevents.init("pk_...", { autoTrack: true })`,
then `Iforevents.track(...)`, `Iforevents.page(...)`, `Iforevents.identify(...)`,
`Iforevents.reset()`, `Iforevents.flush()`.

## Options

Everything from `@iforevents/core`'s `IForeventsAPIConfig` plus `autoTrack`,
`appVersion`, `context`, `integrations`, `disableApi`. `persistQueue` is on
by default here.

## Heatmaps

On by default. Each page view records, aggregated on the device and sent to
`/v1/events/heatmap` every 15 seconds and when the tab is hidden:

- clicks, with the element clicked (a stable CSS selector, its tag and text);
- rage clicks (three or more clicks within 0.8 s on one spot) and dead clicks
  (a click after which nothing on the page changed for a second);
- mouse movement, as a grid of cells (2% of the width by 32 px);
- hesitation: the pointer resting on a link or button for 0.8 s or more
  without clicking;
- exit intent: the pointer leaving the window through the top edge;
- copied text;
- how far down the page was seen, the time on page, and how long each 5%
  band of the page was on screen (attention).

The heatmaps, scroll maps and intent signals are in the dashboard under
**Heatmaps**. Single-page apps get a new page view on every route change.

```ts
createBrowserIforevents("pk_...", {
  heatmaps: {
    sampleRate: 0.5,          // record half of the page views
    mouseMove: true,          // movement cells (default true)
    maskText: false,          // true: never send element or copied text
    ignore: ".chat-widget",   // elements not recorded (also data-iforevents-ignore)
    pageName: (url) => url.pathname.replace(/\/\d+/g, "/:id"), // group dynamic routes
  },
});
// heatmaps: false turns it off. Script tag: data-heatmaps="false" or
// data-heatmaps-sample-rate="0.5".
```

Never recorded: what people type, the value of any field, and anything
inside an element with `data-iforevents-ignore`. Nothing is recorded inside
the dashboard's own preview of the page.

## Adapters

```ts
import { MixpanelIntegration } from "@iforevents/mixpanel/browser";
createBrowserIforevents("pk_...", { integrations: [new MixpanelIntegration({ token: "..." })] });
```

MIT
