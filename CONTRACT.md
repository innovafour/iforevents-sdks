# IForevents SDK Contract

Every IForevents SDK, in every language, implements this contract. It is the
philosophy of `package:iforevents` (Flutter) written down so the other SDKs
mirror it exactly: one facade, pluggable integrations, a first-party API
integration that batches and retries, a public project key and nothing else.

The wire format below was verified against a live api (2026-09-20).

## 1. Shape

```
Iforevents (facade)
  init(integrations | options)
  identify(customId, traits)      -> every integration .identify
  track(name, properties)         -> every integration .track
  page / screen(name, properties) -> every integration .page
  reset()                         -> every integration .reset   (logout)
  flush()                         -> every integration .flush
  shutdown()                      -> flush, stop timers, release resources

Integration (interface / base class)
  init(), identify(event), track(event), page(event), reset(), flush(), shutdown()
  Optional hooks: onInit, onIdentify, onTrack, onPage, onReset (callbacks).

IForeventsAPIIntegration(config)   first-party, talks to /v1/events/*
Third-party adapters               one package per vendor: Mixpanel, Amplitude,
                                   Segment, PostHog, GA4/Firebase, ...
```

Rules:

- One failing integration never breaks the others or the caller. Each call is
  isolated (`safeExecute`) and produces an `IntegrationResult{name, success, error}`.
- `identify` traits (context included) go to every integration once, on
  `identify`. They are **not** copied into later `track` properties: every
  backend keeps them on the user's profile (IForevents joins the profile
  for user-property filters and breakdowns), and copying them made every
  event carry, and store, the same traits and personal data again. The
  facade still remembers them (`currentTraits`); `reset` forgets them.
- Nested property maps are flattened with `_` (`{a:{b:1}}` -> `a_b: 1`) before
  reaching integrations, as Flutter's `flattenMap` does.
- Context is collected automatically and merged into identify traits with the
  Flutter key names: `device_platform`, `device_os_version`,
  `device_app_version`, `device_model`, `device_brand`. Server SDKs add
  `sdk_name`, `sdk_version`, `runtime`. Nothing else is collected by default;
  public IP lookup via third parties is never done (the api records the
  source IP itself).
- Page/screen views are `track` events with `event_type = "page_view"` and
  `event_name = "page_view"` (browser) or the screen name (mobile), with
  `navigation_type`, `to_route`, `previous_route` in properties when known.
  A browser page view sends `url`, `referrer` and `title`; the api derives
  `page` (the path) from `url` and stores the URL as origin plus query, so
  sending the path or the query string again costs bytes and nothing else.

## 2. Credentials

- Config takes `projectKey` only. It is a public write key: safe in browsers
  and app binaries. There is no `projectSecret` field anywhere in any SDK.
- Header: `X-Project-Key: <key>` on every ingest request.

## 3. Wire format (`baseUrl` default `https://api.iforevents.com`)

| Call | Method / path | Body | Success |
|------|---------------|------|---------|
| identify | `POST /v1/events/identify` | `{custom_id, email?, name?, phone_number?, properties}` (`email`, `name`, `phone_number` are lifted out of traits) | `201 {"user":{"uuid": ...}}` |
| track (batchSize == 1) | `POST /v1/events/track` | `{event_name, event_type, properties}` | `201 {"status":"ok","user_uuid": ...}` |
| track (batched) | `POST /v1/events/batch` | `{"events":[{name, type, properties, created_at}]}`, max 500 per request | `202 {"status":"queued","user_uuid": ...}` |

- `event_type` / `type` is `"track"` or `"page_view"`. Always send it: the
  server defaults to `"track"` otherwise and page views vanish.
- Batch by default: one `/batch` request for many events is the cheap path
  for the device, the network and the api alike (defaults below).
- `created_at` is RFC 3339 UTC, set when the event was queued, not when sent.
- `X-User-Id: <id>` is sent on every identify/track/batch request. The SDK
  owns identity: on first run it generates `anon_<uuid4 without dashes>`,
  persists it under `iforevents_user_id` (with `iforevents_user_identified`
  = false) where the platform has storage (localStorage, AsyncStorage,
  prefs/file), and sends it until `identify(customId)` replaces it with
  `customId` (identified = true), set *before* the identify request so
  attribution holds even if that request fails. A user exists by its
  events alone (the api keys it by a hash of the id, no profile); `identify`
  adds a profile with name, e-mail and properties. identify is not an event:
  it is not stored as one and does not count against the plan. `reset`
  flushes, then switches to a fresh anonymous id. The `user_uuid` the api
  returns is informational and ignored. Any string up to 256 characters.
  Without the header the api files events under a profile derived from the
  source address and User-Agent, which merges everyone behind one NAT or
  server into a single user, so SDKs always send it.
- Headers: `Content-Type: application/json`, `User-Agent` (or
  `X-SDK: iforevents-<lang>/<version>` where User-Agent is not settable).

## 4. Errors (all bodies are `{"error": <code or message>, "message"?: ...}`)

| Status | `error` | Class | Retry? | Queue |
|--------|---------|-------|--------|-------|
| 401 / 403 | `invalid project key`, project disabled | `AuthError` | no | drop |
| 429 | `quota_exceeded` (+ `limit`, `used`, `org_uuid`) | `QuotaExceededError` | no | drop, fire `onQuotaExceeded` once until the next success |
| 429 | `ingest_rate_limit_exceeded` (+ `Retry-After` header, `retry_after_seconds`) | `RateLimitedError` | yes, after `Retry-After` | keep |
| 5xx, network, timeout | any | `APIError` | yes, linear backoff `retryDelay * attempt` | keep |
| other 4xx | any | `APIError` | no | drop |

Retries: `maxRetries` (default 3), `retryDelay` (default 1000 ms), honor
`Retry-After` on 429. Events that fail after retries with a transient error go
back to the front of the queue when `requeueFailedEvents` (default true).

## 5. Config defaults (same names, camelCase or snake_case per language)

| Name | Default |
|------|---------|
| `projectKey` | required |
| `baseUrl` | `https://api.iforevents.com` |
| `batchSize` | 20 (1 disables batching; clamp to 1..500) |
| `flushInterval` | 10000 ms |
| `timeout` | 10000 ms |
| `maxRetries` | 3 |
| `retryDelay` | 1000 ms |
| `requeueFailedEvents` | true |
| `enableLogging` / `debug` | false |
| `throwOnError` | false (log and continue) |
| `onQuotaExceeded` | none |
| `storage` | platform default |

## 6. Lifecycle

- `IntegrationResult.success` reflects whether the integration threw. With
  `throwOnError` off (default, as in Flutter) the API integration logs a failed
  request, reports it through `onError` / `onQuotaExceeded`, and returns
  normally, so the result stays `success`; smoke tests and apps that need the
  outcome read `onError` or the typed error from `throwOnError`.
- `flush()` sends the whole queue now (in chunks of 500) and resolves when
  done. Browser: also on `pagehide` / `visibilitychange=hidden` with
  `keepalive`. Server: `shutdown()` flushes and stops the timer; register it on
  process exit where idiomatic (`atexit`, `process.on('beforeExit')`,
  `Runtime.addShutdownHook`, `at_exit`, `register_shutdown_function`).
- Calls before `init` are queued (browser snippet) or answered with a logged
  warning and no throw (mobile / server), never an exception in production
  code paths unless `throwOnError` is on.

## 7. Package naming

| Ecosystem | Core | Adapter pattern |
|-----------|------|-----------------|
| Flutter (existing) | `iforevents` | `iforevents_<vendor>` |
| npm | `@iforevents/core` (+ `browser`, `node`, `react`, `next`, `react-native`) | `@iforevents/<vendor>` |
| PyPI | `iforevents` | extras: `iforevents[<vendor>]`, module `iforevents.integrations.<vendor>` |
| Go | `github.com/innovafour/iforevents-go` | `github.com/innovafour/iforevents-go/integrations/<vendor>` (own go.mod) |
| Maven | `com.iforevents:iforevents` | `com.iforevents:iforevents-<vendor>`; Android: `com.iforevents:iforevents-android` |
| SwiftPM | `IForevents` | `IForevents<Vendor>` |
| RubyGems | `iforevents` | `iforevents-<vendor>` |
| Packagist | `innovafour/iforevents` | `innovafour/iforevents-<vendor>` |
| NuGet | `IForevents` | `IForevents.<Vendor>` |
| Unity (UPM) | `com.iforevents.sdk` | `com.iforevents.<vendor>` |

## 8. Conformance checklist (every SDK's test suite proves these)

1. identify sends the lifted fields and `properties`; `X-User-Id` is the customId from that request on.
2. track after identify carries `X-User-Id: <customId>` and only its own properties, none of the traits.
3. batchSize N: N-1 tracks send nothing, the Nth sends one `/batch` with N events, each with `type` and `created_at`.
4. flushInterval elapses: a partial queue is sent.
5. batchSize 1: `/track` with `event_type`.
6. page view: `type: "page_view"`.
7. before identify every request carries a generated, persisted `anon_...` id; a new instance on the same storage reuses it.
8. reset: queue flushed first, then a fresh anonymous id; later tracks carry the new `anon_...`, never the old customId.
9. 500 then 200: the same events are retried and delivered once.
10. 429 quota_exceeded: no retry, events dropped, `onQuotaExceeded` called once, `isQuotaExceeded` true until next success.
11. 429 rate limit with `Retry-After: 1`: retried after about one second.
12. 401: no retry, events dropped, `AuthError` surfaced in the result / callback.
13. A throwing third-party integration does not stop the API integration from receiving the same event.
14. No request body or header ever contains a string named `secret`.
15. Nested properties are flattened with `_`.
16. Real-API smoke (`IFOREVENTS_PROJECT_KEY` + `IFOREVENTS_BASE_URL` set): identify 201, batch 202, track 201.
