# IForevents SDK for Go

The IForevents analytics SDK for Go. One facade, pluggable integrations, a
first-party API integration with batching, retries and typed errors, and the
public **project key** as the only credential. Same philosophy and vocabulary
as the Flutter package. No dependencies outside the standard library.

```bash
go get github.com/innovafour/iforevents-sdks/go
```

```go
import iforevents "github.com/innovafour/iforevents-sdks/go"

api := iforevents.MustAPIIntegration(iforevents.APIConfig{ProjectKey: os.Getenv("IFOREVENTS_PROJECT_KEY")})
client := iforevents.New(iforevents.WithIntegrations(api))
client.Init(ctx)
defer client.Shutdown(ctx)

client.Identify(ctx, "user_123", iforevents.Properties{"email": "ada@example.com", "plan": "pro"})
client.Track(ctx, "invoice_paid", iforevents.Properties{"amount": 120, "currency": "USD"})
client.Page(ctx, "/pricing", nil, iforevents.PageOptions{})
client.Reset(ctx) // logout
```

> **Credentials.** `ProjectKey` is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id the SDK keeps
per visitor in `Storage`, replaced by your own id on `Identify(customID)`. The
api creates the profile on first sight; identify only adds traits. `Reset`
switches to a fresh anonymous id (logout).

## Adapters (separate modules, so the core stays dependency-free)

| Module | Vendor |
|--------|--------|
| `github.com/innovafour/iforevents-sdks/go/integrations/mixpanel` | `github.com/mixpanel/mixpanel-go` |
| `github.com/innovafour/iforevents-sdks/go/integrations/amplitude` | `github.com/amplitude/analytics-go` |
| `github.com/innovafour/iforevents-sdks/go/integrations/segment` | `github.com/segmentio/analytics-go/v3` |
| `github.com/innovafour/iforevents-sdks/go/integrations/posthog` | `github.com/posthog/posthog-go` |

```go
import "github.com/innovafour/iforevents-sdks/go/integrations/mixpanel"

client := iforevents.New(iforevents.WithIntegrations(api, mixpanel.New(mixpanel.Config{Token: "..."})))
```

Every call fans out to every integration; results come back as
`[]IntegrationResult` and one failing adapter never affects the others.

## Custom integration

```go
type Console struct{ iforevents.BaseIntegration }

func (c *Console) Track(ctx context.Context, e iforevents.TrackEvent) error {
	_ = c.BaseIntegration.Track(ctx, e)
	log.Println(e.Name, e.Properties)
	return nil
}
```

## APIConfig

| Field | Default | Meaning |
|-------|---------|---------|
| `ProjectKey` | required | public write key |
| `BaseURL` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `BatchSize` | `20` | events per request; 1 disables batching; max 500 |
| `FlushInterval` | `10s` | how long a partial batch waits |
| `Timeout` | `10s` | per request |
| `MaxRetries` / `RetryDelay` | `3` / `1s` | linear backoff, `Retry-After` honored; `MaxRetries: -1` disables |
| `DisableRequeue` | `false` | drop events after transient failures |
| `Storage` / `PersistQueue` | memory / `false` | `NewFileStorage(path)` keeps uuid and queue across runs |
| `ReturnErrors` | `false` | return request errors from Identify/Flush/Reset instead of only reporting |
| `OnQuotaExceeded`, `OnError` | – | callbacks |
| `HTTPClient`, `UserAgent`, `Logger`, `Debug` | – | transport and logging |

Errors (use `errors.As`): `*APIError`, `*AuthError` (401/403, dropped),
`*QuotaExceededError` (429 `quota_exceeded`, dropped), `*RateLimitedError`
(429, retried after `Retry-After`).

## Development

```bash
go test -race ./...                                   # core
for m in integrations/*; do (cd $m && go test -race ./...); done
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 go run ./cmd/smoke
```

Releases: tag `go/v0.1.0` on the core module first, then
`go/integrations/<name>/v0.1.0` for each adapter (the adapters require the
core module by version; the `replace` directives only serve local development).

MIT
