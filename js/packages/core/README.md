# @iforevents/core

The IForevents analytics SDK core for JavaScript and TypeScript: one facade,
pluggable integrations, and the first-party API integration with batching,
an offline queue, retries and typed errors. Runs anywhere `fetch` exists
(browsers, Node 18+, Bun, Deno, React Native, edge runtimes).

Most apps install a platform package instead, which wires the right storage
and context on top of this core:

- Browser: `@iforevents/browser`
- Node.js: `@iforevents/node`
- React: `@iforevents/react`, Next.js: `@iforevents/next`
- React Native: `@iforevents/react-native`

> **Credentials.** The SDK takes a **project key** only. That key is public by
> design: it grants event ingestion and nothing else, so shipping it in a
> bundle is safe. There is no project secret in the SDK and never will be.

## Install

```bash
npm install @iforevents/core
```

## Use

```ts
import { Iforevents, IForeventsAPIIntegration } from "@iforevents/core";

const iforevents = new Iforevents();
await iforevents.init({
  integrations: [new IForeventsAPIIntegration({ projectKey: "pk_..." })],
});

await iforevents.identify("user_123", { email: "ada@example.com", plan: "pro" });
await iforevents.track("checkout_completed", { total: 99.99, items: 3 });
await iforevents.page("/pricing");
await iforevents.reset(); // logout
```

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id the SDK keeps
per visitor in `storage`, replaced by your own id on `identify(customId)`.
The api creates the profile on first sight; `identify` only adds traits.
`reset()` switches to a fresh anonymous id (logout).

## Integrations

Extend `Integration` and override what the vendor supports. Call `super`
first so hooks run. One failing integration never affects the others.

```ts
import { Integration, type TrackEvent } from "@iforevents/core";

class ConsoleIntegration extends Integration {
  override async track(event: TrackEvent) {
    await super.track(event);
    console.log(event.name, event.properties);
  }
}
```

Official adapters: `@iforevents/mixpanel`, `@iforevents/amplitude`,
`@iforevents/segment`, `@iforevents/posthog`, `@iforevents/ga4`.

## API integration options

| Option | Default | Meaning |
|--------|---------|---------|
| `projectKey` | required | public write key |
| `baseUrl` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `batchSize` | `10` | events per request, 1 disables batching, max 500 |
| `flushInterval` | `5000` | ms a partial batch waits |
| `timeout` | `10000` | ms per request |
| `maxRetries` / `retryDelay` | `3` / `1000` | linear backoff; `Retry-After` honored |
| `requeueFailedEvents` | `true` | keep events after transient failures |
| `persistQueue` | `false` | store the pending queue in `storage` |
| `storage` | memory | `WebStorage(localStorage)` in browsers |
| `throwOnError` | `false` | reject instead of log |
| `onQuotaExceeded` | – | called once per `quota_exceeded` outage |
| `onError` | – | every failed request after retries |
| `debug` | `false` | log requests |

## Errors

`IForeventsAPIError` (base), `IForeventsAuthError` (401/403, dropped),
`IForeventsQuotaExceededError` (429 `quota_exceeded`, dropped),
`IForeventsRateLimitedError` (429, retried after `Retry-After`).

## License

MIT
