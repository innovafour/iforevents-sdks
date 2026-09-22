# @iforevents/posthog

PostHog adapter for the IForevents SDK (browser `posthog-js`, Node.js `posthog-node`).

```ts
import { PostHogIntegration } from "@iforevents/posthog/browser";
createBrowserIforevents("pk_...", { integrations: [new PostHogIntegration({ apiKey: "phc_...", config: { api_host: "https://eu.i.posthog.com" } })] });
```

MIT
