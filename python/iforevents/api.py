"""The first-party API integration: identify, batched track, page views,
persisted user uuid, retries with ``Retry-After`` and typed errors. Mirrors
``IForeventsAPIIntegration`` of the Flutter package.

Only ``project_key`` is required. It is a public write key: it grants event
ingestion and nothing else. There is deliberately no project secret here.
"""
from __future__ import annotations

import atexit
import json
import logging
import threading
import time
import urllib.error
import urllib.request
import uuid as _uuid
from typing import Any, Callable, Dict, List, Optional

from .errors import IForeventsAPIError, IForeventsQuotaExceededError, IForeventsRateLimitedError, classify_response
from .events import IdentifyEvent, PageEvent, TrackEvent
from .integration import Integration
from .storage import MemoryStorage, Storage

USER_KEY = "iforevents_user_id"
IDENTIFIED_KEY = "iforevents_user_identified"
QUEUE_KEY = "iforevents_queue"
MAX_BATCH = 500
DEFAULT_BASE_URL = "https://api.iforevents.com"
LIFTED_TRAITS = ("email", "name", "phone_number")

log = logging.getLogger("iforevents")


class IForeventsAPIIntegration(Integration):
    def __init__(
        self,
        project_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        batch_size: int = 10,
        flush_interval: float = 5.0,
        timeout: float = 10.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        requeue_failed_events: bool = True,
        debug: bool = False,
        throw_on_error: bool = False,
        on_quota_exceeded: Optional[Callable[[IForeventsQuotaExceededError], None]] = None,
        on_error: Optional[Callable[[IForeventsAPIError], None]] = None,
        storage: Optional[Storage] = None,
        persist_queue: bool = False,
        max_queue_size: int = 1000,
        user_agent: Optional[str] = None,
        flush_at_exit: bool = True,
        opener: Optional[Callable[[urllib.request.Request, float], Any]] = None,
        **hooks: Any,
    ) -> None:
        if "project_secret" in hooks:
            raise ValueError("the project secret never belongs in an SDK; pass the project key only")
        super().__init__(name="IForeventsAPIIntegration", **hooks)
        if not isinstance(project_key, str) or not project_key.strip():
            raise ValueError("IForeventsAPIIntegration needs a project_key")
        self.project_key = project_key
        self.base_url = base_url.rstrip("/")
        self.batch_size = max(1, min(MAX_BATCH, int(batch_size)))
        self.flush_interval = flush_interval
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.requeue_failed_events = requeue_failed_events
        self.debug = debug
        self.throw_on_error = throw_on_error
        self.on_quota_exceeded = on_quota_exceeded
        self.on_error = on_error
        self.storage: Storage = storage or MemoryStorage()
        self.persist_queue = persist_queue
        self.max_queue_size = max_queue_size
        from .context import SDK_NAME, SDK_VERSION  # local import keeps module load light
        import platform as _platform

        self.user_agent = user_agent or f"{SDK_NAME}/{SDK_VERSION} python/{_platform.python_version()} ({_platform.system()}; {_platform.machine()})"
        self._open = opener or self._default_open

        self._queue: List[Dict[str, Any]] = []
        self._lock = threading.RLock()
        self._send_lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._user_id: Optional[str] = None
        self._initialized = False
        self._identified = False
        self._quota_exceeded = False
        if flush_at_exit:
            atexit.register(self._atexit)

    # --- state -----------------------------------------------------------------

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def is_identified(self) -> bool:
        return self._identified

    @property
    def user_id(self) -> Optional[str]:
        """The id every request carries in ``X-User-Id``: a generated ``anon_...`` id kept per visitor, or the custom_id of the last identify."""
        return self._user_id

    @property
    def queued_events_count(self) -> int:
        with self._lock:
            return len(self._queue)

    @property
    def is_quota_exceeded(self) -> bool:
        """True after a ``quota_exceeded`` answer until the next accepted request."""
        return self._quota_exceeded

    # --- Integration ------------------------------------------------------------

    def init(self) -> None:
        super().init()
        stored = self.storage.get(USER_KEY)
        if stored:
            self._user_id = stored
            self._identified = self.storage.get(IDENTIFIED_KEY) == "true"
        else:
            # A fresh visitor: attribute everything to an anonymous id we own, so the
            # api never has to fingerprint the address (which merges users behind a NAT).
            self._set_user(anonymous_id(), identified=False)
        if self.persist_queue:
            raw = self.storage.get(QUEUE_KEY)
            if raw:
                try:
                    events = json.loads(raw)
                    if isinstance(events, list) and events:
                        with self._lock:
                            self._queue = (events + self._queue)[-self.max_queue_size :]
                        self._schedule()
                except ValueError:
                    self.storage.remove(QUEUE_KEY)
        self._initialized = True
        self._log("api integration ready base_url=%s batch_size=%s", self.base_url, self.batch_size)

    def identify(self, event: IdentifyEvent) -> None:
        super().identify(event)
        properties = dict(event.traits)
        body: Dict[str, Any] = {"custom_id": event.custom_id}
        for key in LIFTED_TRAITS:
            value = properties.pop(key, None)
            if isinstance(value, str) and value:
                body[key] = value
        body["properties"] = properties
        # Attribute from now on, even if the profile request itself fails: the
        # api creates the profile on the first event it sees for this id.
        self._set_user(event.custom_id, identified=True)
        try:
            self._request("/v1/events/identify", body)
        except IForeventsAPIError as exc:
            self._report(exc)
            if self.throw_on_error:
                raise

    def track(self, event: TrackEvent) -> None:
        super().track(event)
        queued = {"name": event.name, "type": event.type, "properties": event.properties, "created_at": _iso(event.timestamp)}
        if self.batch_size <= 1:
            try:
                self._request("/v1/events/track", {"event_name": queued["name"], "event_type": queued["type"], "properties": queued["properties"]})
            except IForeventsAPIError as exc:
                self._report(exc)
                if self.throw_on_error:
                    raise
            return
        with self._lock:
            self._queue.append(queued)
            if len(self._queue) > self.max_queue_size:
                del self._queue[: len(self._queue) - self.max_queue_size]
            full = len(self._queue) >= self.batch_size
            self._persist()
        if full:
            self.flush()
        else:
            self._schedule()

    def page(self, event: PageEvent) -> None:
        super().page(event)
        properties = dict(event.properties)
        if event.navigation_type is not None:
            properties["navigation_type"] = event.navigation_type
        if event.to_route is not None:
            properties["to_route"] = event.to_route
        if event.previous_route is not None:
            properties["previous_route"] = event.previous_route
        self.track(TrackEvent(name=event.name or "page_view", type="page_view", properties=properties, timestamp=event.timestamp))

    def reset(self) -> None:
        super().reset()
        self.flush()
        # Forget the person; the next events belong to a fresh anonymous id.
        self._set_user(anonymous_id(), identified=False)

    def flush(self) -> None:
        """Sends the whole queue now, 500 events per request. Blocks until done."""
        self._cancel_timer()
        with self._send_lock:
            while True:
                with self._lock:
                    if not self._queue:
                        return
                    events = self._queue[:MAX_BATCH]
                    del self._queue[:MAX_BATCH]
                try:
                    self._request("/v1/events/batch", {"events": events})
                    with self._lock:
                        self._persist()
                except IForeventsAPIError as exc:
                    with self._lock:
                        if exc.retryable and self.requeue_failed_events:
                            self._queue[0:0] = events
                            self._schedule()
                        elif not exc.retryable:
                            self._queue.clear()
                        self._persist()
                    self._report(exc)
                    if self.throw_on_error:
                        raise
                    return

    def shutdown(self) -> None:
        self.flush()
        self._cancel_timer()

    # --- internals ----------------------------------------------------------------

    def _atexit(self) -> None:
        try:
            self.shutdown()
        except Exception:  # noqa: BLE001
            pass

    def _schedule(self) -> None:
        with self._lock:
            if self._timer is not None or not self._queue:
                return
            self._timer = threading.Timer(self.flush_interval, self._timer_fired)
            self._timer.daemon = True
            self._timer.start()

    def _timer_fired(self) -> None:
        with self._lock:
            self._timer = None
        self.flush()

    def _cancel_timer(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def _set_user(self, user_id: str, *, identified: bool) -> None:
        self._user_id = user_id
        self._identified = identified
        self.storage.set(USER_KEY, user_id)
        self.storage.set(IDENTIFIED_KEY, "true" if identified else "false")

    def _persist(self) -> None:
        if not self.persist_queue:
            return
        if self._queue:
            self.storage.set(QUEUE_KEY, json.dumps(self._queue))
        else:
            self.storage.remove(QUEUE_KEY)

    def _report(self, error: IForeventsAPIError) -> None:
        self._log("request failed: %s", error)
        if self.on_error:
            self.on_error(error)

    def _note_outcome(self, error: Optional[IForeventsAPIError]) -> None:
        if isinstance(error, IForeventsQuotaExceededError):
            if not self._quota_exceeded:
                self._quota_exceeded = True
                if self.on_quota_exceeded:
                    self.on_quota_exceeded(error)
        elif error is None:
            self._quota_exceeded = False

    def _log(self, msg: str, *args: Any) -> None:
        if self.debug:
            log.info(msg, *args)

    @staticmethod
    def _default_open(req: urllib.request.Request, timeout: float) -> Any:
        return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310 - https api origin from config

    def _request(self, path: str, body: Any) -> Any:
        """POSTs JSON with retries; returns the decoded body (or None)."""
        headers = {"Content-Type": "application/json", "X-Project-Key": self.project_key, "User-Agent": self.user_agent}
        if self._user_id:
            headers["X-User-Id"] = self._user_id
        payload = json.dumps(body, default=str).encode("utf-8")
        url = f"{self.base_url}{path}"
        attempt = 0
        while True:
            error: IForeventsAPIError
            try:
                req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
                with self._open(req, self.timeout) as res:
                    status = res.status
                    text = res.read().decode("utf-8")
                data = _parse_json(text)
                self._log("POST %s -> %s", path, status)
                self._note_outcome(None)
                return data
            except urllib.error.HTTPError as exc:
                text = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                self._log("POST %s -> %s", path, exc.code)
                error = classify_response(exc.code, _parse_json(text), exc.headers.get("Retry-After") if exc.headers else None)
            except (urllib.error.URLError, OSError, TimeoutError) as exc:
                error = IForeventsAPIError(str(exc))
            if not error.retryable or attempt >= self.max_retries:
                self._note_outcome(error)
                raise error
            retry_after = getattr(error, "retry_after", None)
            delay = retry_after if isinstance(error, IForeventsRateLimitedError) and retry_after and retry_after > 0 else self.retry_delay * (attempt + 1)
            self._log("retrying %s in %.1fs (%d/%d)", path, delay, attempt + 1, self.max_retries)
            time.sleep(delay)
            attempt += 1


def anonymous_id() -> str:
    """A fresh anonymous id, unrelated to anything the server derives: ``anon_<uuid4 without dashes>``."""
    return f"anon_{_uuid.uuid4().hex}"


def _parse_json(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _iso(value: Any) -> str:
    if hasattr(value, "isoformat"):
        s = value.isoformat()
        return s.replace("+00:00", "Z")
    return str(value)
