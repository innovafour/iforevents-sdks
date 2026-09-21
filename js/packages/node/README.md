# @iforevents/node

IForevents analytics for Node.js servers. Batches events, retries transient
failures, drains the queue on exit, and fans every call out to any
third-party adapter you add. Built on `@iforevents/core`.

> The SDK takes the **project key** only. It is a public write key. The
> project secret belongs to your server-side analytics reads, never here.

```bash
npm install @iforevents/node
```

```ts
import { createIforevents } from "@iforevents/node";

const { iforevents, shutdown } = await createIforevents({
  projectKey: process.env.IFOREVENTS_PROJECT_KEY!,
  // baseUrl: "https://your-self-hosted-api", batchSize: 50, flushInterval: 2000,
});

await iforevents.identify("user_123", { email: "ada@example.com", plan: "pro" });
await iforevents.track("invoice_paid", { amount: 120, currency: "USD" });

process.on("SIGTERM", () => shutdown().finally(() => process.exit(0)));
```

Adapters: `@iforevents/mixpanel`, `@iforevents/amplitude`, `@iforevents/segment`, `@iforevents/posthog`.

```ts
import { MixpanelIntegration } from "@iforevents/mixpanel/node";
const { iforevents } = await createIforevents({ projectKey, integrations: [new MixpanelIntegration({ token })] });
```

MIT
