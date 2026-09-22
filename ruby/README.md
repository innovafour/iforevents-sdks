# IForevents SDK for Ruby

The IForevents analytics SDK for Ruby apps, Rails, workers and CLIs. One
facade, pluggable integrations, a first-party API integration with batching,
retries and typed errors, and the public **project key** as the only
credential. Standard library only. Same philosophy as the Flutter package.

```ruby
gem "iforevents"
gem "iforevents-mixpanel" # optional adapters
gem "iforevents-segment"
```

```ruby
require "iforevents"

analytics = Iforevents.new(project_key: ENV.fetch("IFOREVENTS_PROJECT_KEY"))
analytics.identify("user_123", email: "ada@example.com", plan: "pro")
analytics.track("invoice_paid", amount: 120, currency: "USD")
analytics.page("/pricing")
analytics.reset      # logout
analytics.shutdown   # also runs at_exit
```

Or build the client yourself:

```ruby
api = Iforevents::APIIntegration.new(project_key: "pk_...", batch_size: 50)
analytics = Iforevents::Client.new([api, Iforevents::Integrations::Mixpanel.new(token: "...")])
analytics.init
```

> **Credentials.** The project key is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id kept per
process (or per file with `FileStorage`), replaced by your own id on
`identify`. The api creates the profile on first sight; identify only adds
traits. `reset` switches to a fresh anonymous id.

## Custom integration

```ruby
class ConsoleIntegration < Iforevents::Integration
  def track(event)
    super
    puts "#{event.name} #{event.properties}"
  end
end
```

## APIIntegration options

| Option | Default | Meaning |
|--------|---------|---------|
| `base_url` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `batch_size` | `10` | events per request; 1 disables batching; max 500 |
| `flush_interval` | `5.0` s | how long a partial batch waits |
| `timeout` | `10.0` s | per request |
| `max_retries` / `retry_delay` | `3` / `1.0` s | linear backoff, `Retry-After` honored |
| `requeue_failed_events` | `true` | keep events after transient failures |
| `storage` / `persist_queue` | memory / `false` | `FileStorage.new(path)` keeps user id and queue across runs |
| `throw_on_error` | `false` | raise from identify/flush instead of only reporting |
| `on_quota_exceeded`, `on_error` | – | callbacks |
| `flush_at_exit` | `true` | `at_exit` drain |

Errors: `Iforevents::APIError`, `AuthError` (401/403, dropped),
`QuotaExceededError` (429 `quota_exceeded`, dropped), `RateLimitedError`
(429, retried after `Retry-After`).

## Development

```bash
(cd iforevents && ruby -Ilib -Itest test/conformance_test.rb)
(cd iforevents-mixpanel && ruby -I../iforevents/lib -Ilib test/mixpanel_test.rb)
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 ruby iforevents/bin/smoke
```

MIT
