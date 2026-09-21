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

## Adapters

```ts
import { MixpanelIntegration } from "@iforevents/mixpanel/browser";
createBrowserIforevents("pk_...", { integrations: [new MixpanelIntegration({ token: "..." })] });
```

MIT
