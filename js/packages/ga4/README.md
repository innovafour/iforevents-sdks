# @iforevents/ga4

Google Analytics 4 adapter for the IForevents SDK (browser, via gtag.js).
Loads `gtag.js` when the page does not have it and disables GA's own page
views so IForevents drives them.

```ts
import { GA4Integration } from "@iforevents/ga4";
createBrowserIforevents("pk_...", { integrations: [new GA4Integration({ measurementId: "G-XXXXXXX" })] });
```

MIT
