# IForevents SDK for .NET

The IForevents analytics SDK for .NET (netstandard2.0 and net8.0): ASP.NET
Core, workers, desktop and console apps. One facade, pluggable integrations,
a first-party API integration with batching, retries and typed errors, and
the public **project key** as the only credential. Same philosophy as the
Flutter package.

```bash
dotnet add package IForevents
dotnet add package IForevents.Segment   # optional adapters
dotnet add package IForevents.PostHog
```

```csharp
using IForevents;

var analytics = await Iforevents.CreateAsync(Environment.GetEnvironmentVariable("IFOREVENTS_PROJECT_KEY")!, c => c.BatchSize = 20);
await analytics.IdentifyAsync("user_123", new Dictionary<string, object?> { ["email"] = "ada@example.com", ["plan"] = "pro" });
await analytics.TrackAsync("invoice_paid", new Dictionary<string, object?> { ["amount"] = 120, ["currency"] = "USD" });
await analytics.PageAsync("/pricing");
await analytics.ResetAsync();     // logout
await analytics.ShutdownAsync();  // drain before the process exits
```

Or wire it yourself (for DI, register the `Iforevents` instance as a singleton):

```csharp
var api = new ApiIntegration("pk_...", c => { c.Storage = new FileStorage("iforevents.json"); c.PersistQueue = true; });
var analytics = new Iforevents(new IIntegration[] { api, new SegmentIntegration("SEGMENT_WRITE_KEY") });
await analytics.InitAsync();
```

> **Credentials.** The project key is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id kept in
`IStorage` (memory by default, `FileStorage` for apps and CLIs), replaced by
your own id on `IdentifyAsync`. The api creates the profile on first sight;
identify only adds traits. `ResetAsync` switches to a fresh anonymous id.

## ApiConfig

| Property | Default | Meaning |
|----------|---------|---------|
| `BaseUrl` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `BatchSize` | `10` | events per request; 1 disables batching; max 500 |
| `FlushInterval` | `5s` | how long a partial batch waits |
| `Timeout` | `10s` | per request |
| `MaxRetries` / `RetryDelay` | `3` / `1s` | linear backoff, `Retry-After` honored |
| `RequeueFailedEvents` | `true` | keep events after transient failures |
| `Storage` / `PersistQueue` | memory / `false` | keep user id and queue across runs |
| `ThrowOnError` | `false` | throw from Identify/Flush/Reset instead of only reporting |
| `OnQuotaExceeded`, `OnError` | – | callbacks |
| `HttpClient` | new | inject your own (tests pass a fake handler) |

Exceptions: `IForeventsApiException`, `IForeventsAuthException` (401/403,
dropped), `IForeventsQuotaExceededException` (429 `quota_exceeded`, dropped),
`IForeventsRateLimitedException` (429, retried after `Retry-After`).

## Development

```bash
./docker-run.sh test                                    # xUnit in mcr.microsoft.com/dotnet/sdk:8.0
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://host.docker.internal:8000 ./docker-run.sh run --project tools/Smoke
./docker-run.sh pack src/IForevents/IForevents.csproj -c Release -o /app/artifacts
```

MIT
