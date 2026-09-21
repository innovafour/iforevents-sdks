# iforevents (Python)

The IForevents analytics SDK for Python servers, workers and CLIs. One
facade, pluggable integrations, a first-party API integration with batching,
retries and typed errors, and the public **project key** as the only
credential. Same philosophy and vocabulary as the Flutter package.

```bash
pip install iforevents
pip install "iforevents[mixpanel]"      # optional adapters: mixpanel, amplitude, segment, posthog, all
```

```python
from iforevents import Iforevents, IForeventsAPIIntegration

iforevents = Iforevents([IForeventsAPIIntegration(project_key="pk_...")])
iforevents.init()

iforevents.identify("user_123", {"email": "ada@example.com", "plan": "pro"})
iforevents.track("invoice_paid", {"amount": 120, "currency": "USD"})
iforevents.page("/pricing")
iforevents.reset()      # logout
iforevents.shutdown()   # also registered with atexit
```

> **Credentials.** `project_key` is a public write key: it grants event
> ingestion and nothing else. There is no project secret in the SDK.

## Identity

Every request carries `X-User-Id`: a generated `anon_...` id the SDK keeps per
visitor in `storage`, replaced by your own id on `identify(custom_id)`. The api
creates the profile on first sight; `identify` only adds traits. `reset()`
switches to a fresh anonymous id (logout).

## Adapters

```python
from iforevents.integrations.mixpanel import MixpanelIntegration
from iforevents.integrations.segment import SegmentIntegration

iforevents = Iforevents([
    IForeventsAPIIntegration(project_key="pk_..."),
    MixpanelIntegration(token="..."),
    SegmentIntegration(write_key="..."),
])
```

Every call fans out to every integration; one failing adapter never affects
the others. Pass `client=` to reuse a vendor instance you already built.

## Custom integration

```python
from iforevents import Integration, TrackEvent

class ConsoleIntegration(Integration):
    def track(self, event: TrackEvent) -> None:
        super().track(event)
        print(event.name, event.properties)
```

## API integration options

| Option | Default | Meaning |
|--------|---------|---------|
| `project_key` | required | public write key |
| `base_url` | `https://api.iforevents.com` | api origin (self-hosted: your host) |
| `batch_size` | `10` | events per request; 1 disables batching; max 500 |
| `flush_interval` | `5.0` s | how long a partial batch waits |
| `timeout` | `10.0` s | per request |
| `max_retries` / `retry_delay` | `3` / `1.0` s | linear backoff, `Retry-After` honored |
| `requeue_failed_events` | `True` | keep events after transient failures |
| `storage` / `persist_queue` | memory / `False` | `FileStorage(path)` keeps uuid and queue across runs |
| `throw_on_error` | `False` | raise instead of log |
| `on_quota_exceeded`, `on_error` | – | callbacks |
| `flush_at_exit` | `True` | `atexit` drain |

Errors: `IForeventsAPIError`, `IForeventsAuthError` (401/403, dropped),
`IForeventsQuotaExceededError` (429 `quota_exceeded`, dropped),
`IForeventsRateLimitedError` (429, retried after `Retry-After`).

## Development

```bash
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest
IFOREVENTS_PROJECT_KEY=pk_... IFOREVENTS_BASE_URL=http://127.0.0.1:8000 .venv/bin/python scripts/smoke.py
```

MIT
