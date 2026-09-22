# IForevents SDKs for JavaScript

Analytics SDKs for every JavaScript runtime, built on one core and the same
philosophy as the Flutter package: a facade, pluggable integrations, a
first-party API integration with batching, an offline queue and retries, and
the public **project key** as the only credential.

| Package | For | Install |
|---------|-----|---------|
| [`@iforevents/core`](packages/core) | any runtime with `fetch` | `npm i @iforevents/core` |
| [`@iforevents/browser`](packages/browser) | web apps and script tags | `npm i @iforevents/browser` |
| [`@iforevents/node`](packages/node) | Node.js servers | `npm i @iforevents/node` |
| [`@iforevents/react`](packages/react) | React (hooks, provider) | `npm i @iforevents/react` |
| [`@iforevents/next`](packages/next) | Next.js App Router + server | `npm i @iforevents/next` |
| [`@iforevents/react-native`](packages/react-native) | React Native / Expo | `npm i @iforevents/react-native` |

Adapters (one call fans out to every vendor you add):

| Adapter | Vendor SDKs |
|---------|-------------|
| [`@iforevents/mixpanel`](packages/mixpanel) | `mixpanel-browser`, `mixpanel` |
| [`@iforevents/amplitude`](packages/amplitude) | `@amplitude/analytics-browser`, `@amplitude/analytics-node` |
| [`@iforevents/segment`](packages/segment) | `@segment/analytics-next`, `@segment/analytics-node` |
| [`@iforevents/posthog`](packages/posthog) | `posthog-js`, `posthog-node` |
| [`@iforevents/ga4`](packages/ga4) | gtag.js |

## Quick start

```ts
import { createBrowserIforevents } from "@iforevents/browser";
import { MixpanelIntegration } from "@iforevents/mixpanel/browser";

const analytics = createBrowserIforevents("pk_...", {
  autoTrack: true,
  integrations: [new MixpanelIntegration({ token: "..." })],
});
await analytics.identify("user_123", { email: "ada@example.com", plan: "pro" });
await analytics.track("signup_completed", { plan: "pro" });
```

## Development

```bash
pnpm install
pnpm -r typecheck && pnpm -r build && pnpm -r test
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 pnpm --filter @iforevents/node smoke
```

The behavior every package must satisfy is written in
[`../CONTRACT.md`](../CONTRACT.md); `packages/core/test/conformance.test.ts`
proves it item by item.

MIT
