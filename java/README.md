# IForevents SDK for Java

The IForevents analytics SDK for the JVM: servers, workers, desktop apps, and
Android (the core is Java 8 with `HttpURLConnection` and no dependencies;
`com.iforevents:iforevents-android` adds device context and lifecycle
tracking on top). One facade, pluggable integrations, a first-party API
integration with batching, retries and typed errors, and the public **project
key** as the only credential. Same philosophy as the Flutter package.

```xml
<dependency>
  <groupId>com.iforevents</groupId>
  <artifactId>iforevents</artifactId>
  <version>0.1.0</version>
</dependency>
```

```java
import com.iforevents.*;

IForeventsAPIIntegration api = new IForeventsAPIIntegration(APIConfig.builder(System.getenv("IFOREVENTS_PROJECT_KEY")).build());
Iforevents iforevents = Iforevents.builder().integration(api).build();
iforevents.init();

iforevents.identify("user_123", Map.of("email", "ada@example.com", "plan", "pro"));
iforevents.track("invoice_paid", Map.of("amount", 120, "currency", "USD"));
iforevents.page("/pricing", null);
iforevents.reset();     // logout
iforevents.shutdown();  // also runs from a JVM shutdown hook
```

> **Credentials.** The project key is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id the SDK keeps
per visitor in `Storage` (`MemoryStorage` by default, `FileStorage` for
CLIs and desktop apps), replaced by your own id on `identify(customId)`. The
api creates the profile on first sight; identify only adds traits. `reset()`
switches to a fresh anonymous id.

## Adapters

| Artifact | Vendor |
|----------|--------|
| `iforevents-mixpanel` | `com.mixpanel:mixpanel-java` |
| `iforevents-amplitude` | `com.amplitude:java-sdk` |
| `iforevents-segment` | `com.segment.analytics.java:analytics` |
| `iforevents-posthog` | `com.posthog.java:posthog` |

```java
Iforevents.builder()
    .integration(api)
    .integration(new MixpanelIntegration("MIXPANEL_TOKEN"))
    .integration(new SegmentIntegration("SEGMENT_WRITE_KEY"))
    .build();
```

Every call fans out to every integration and returns `List<IntegrationResult>`;
one failing adapter never affects the others. Each adapter also accepts a
small interface (`Sender`, `Client`, `Sink`) so you can reuse a vendor
instance you already configured, or a fake in tests.

## Custom integration

```java
class ConsoleIntegration extends BaseIntegration {
    ConsoleIntegration() { super("Console", null); }
    @Override public void track(TrackEvent e) throws Exception {
        super.track(e);
        System.out.println(e.name + " " + e.properties);
    }
}
```

## APIConfig

| Builder method | Default | Meaning |
|----------------|---------|---------|
| `baseUrl` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `batchSize` | `10` | events per request; 1 disables batching; max 500 |
| `flushIntervalMillis` | `5000` | how long a partial batch waits |
| `timeoutMillis` | `10000` | per request |
| `maxRetries` / `retryDelayMillis` | `3` / `1000` | linear backoff, `Retry-After` honored |
| `requeueFailedEvents` | `true` | keep events after transient failures |
| `storage` / `persistQueue` | memory / `false` | keep user id and queue across runs |
| `throwOnError` | `false` | throw from identify/flush/reset instead of only reporting |
| `onQuotaExceeded`, `onError` | – | callbacks |
| `flushOnShutdownHook` | `true` | JVM shutdown hook drains the queue |

Errors: `IForeventsAPIException` and its nested `AuthException` (401/403,
dropped), `QuotaExceededException` (429 `quota_exceeded`, dropped),
`RateLimitedException` (429, retried after `Retry-After`).

## Development

```bash
mvn test
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 \
  java -cp iforevents/target/classes:iforevents/target/test-classes com.iforevents.Smoke
```

MIT
