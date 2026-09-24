# IForevents SDK for PHP

The IForevents analytics SDK for PHP 8.1+: Laravel, Symfony, plain PHP,
workers and CLIs. One facade, pluggable integrations, a first-party API
integration with batching, retries and typed errors, and the public
**project key** as the only credential. Needs only `ext-json` and `ext-curl`.
Same philosophy as the Flutter package.

```bash
composer require innovafour/iforevents
composer require innovafour/iforevents-mixpanel innovafour/iforevents-segment   # optional adapters
```

```php
use IForevents\Iforevents;

$analytics = Iforevents::create(getenv('IFOREVENTS_PROJECT_KEY'), ['batchSize' => 20]);
$analytics->identify('user_123', ['email' => 'ada@example.com', 'plan' => 'pro']);
$analytics->track('invoice_paid', ['amount' => 120, 'currency' => 'USD']);
$analytics->page('/pricing');
$analytics->reset();     // logout
$analytics->shutdown();  // also runs from register_shutdown_function
```

Or wire it yourself:

```php
use IForevents\{APIConfig, APIIntegration, Iforevents, SessionStorage};
use IForevents\Integrations\MixpanelIntegration;

$config = new APIConfig('pk_...');
$config->storage = new SessionStorage(); // the anonymous id follows the visitor's PHP session
$analytics = new Iforevents([new APIIntegration($config), new MixpanelIntegration('MIXPANEL_TOKEN')]);
$analytics->init();
```

> **Credentials.** The project key is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id kept in the
configured storage (memory per request by default; `SessionStorage` for web
sessions, `FileStorage` for CLIs), replaced by your own id on `identify`.
The api creates the profile on first sight; identify only adds traits.
`reset()` switches to a fresh anonymous id.

## Batching in PHP

PHP has no background timers: a batch is sent when it reaches `batchSize`,
when a partial batch is older than `flushInterval` and another event
arrives, on `flush()`/`shutdown()`, and at script end. Set `batchSize` to 1
to send every event immediately.

## APIConfig

| Property | Default | Meaning |
|----------|---------|---------|
| `baseUrl` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `batchSize` | `20` | events per request; 1 disables batching; max 500 |
| `flushInterval` | `10.0` s | age at which a partial batch is sent with the next event |
| `timeout` | `10.0` s | per request |
| `maxRetries` / `retryDelay` | `3` / `1.0` s | linear backoff, `Retry-After` honored |
| `requeueFailedEvents` | `true` | keep events after transient failures |
| `storage` / `persistQueue` | memory / `false` | keep user id and queue across requests or runs |
| `throwOnError` | `false` | throw from identify/flush instead of only reporting |
| `onQuotaExceeded`, `onError` | – | callbacks |
| `flushOnShutdown` | `true` | drain at script end |
| `transport` | curl | custom `callable(url, payload, headers, timeout)` |

Exceptions: `IForevents\APIException`, `AuthException` (401/403, dropped),
`QuotaExceededException` (429 `quota_exceeded`, dropped), `RateLimitedException`
(429, retried after `Retry-After`).

## Development

```bash
./docker-test.sh            # composer install + phpunit for every package in php:8.3-cli
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 php iforevents/bin/smoke.php
```

MIT
