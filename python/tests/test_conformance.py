"""Conformance suite for sdks/CONTRACT.md section 8; each test names its item."""
from __future__ import annotations

import time

import pytest

from iforevents import (
    IForeventsAPIIntegration,
    IForeventsAuthError,
    IForeventsQuotaExceededError,
    IForeventsRateLimitedError,
    Iforevents,
    Integration,
    MemoryStorage,
    TrackEvent,
    flatten,
)

import re

ANON = re.compile(r"^anon_[0-9a-f]{32}$")


def make(api, **overrides):
    opts = dict(base_url=api.base_url, retry_delay=0.01, flush_interval=0.06, flush_at_exit=False)
    opts.update(overrides)
    return IForeventsAPIIntegration("pk_test", **opts)


def boot(api, extra=(), **overrides):
    integration = make(api, **overrides)
    ife = Iforevents([integration, *extra], context=lambda: {"device_platform": "test", "sdk_name": "iforevents-python"})
    ife.init()
    return ife, integration


def test_01_identify_lifts_fields_sends_properties_switches_user_id(api):
    ife, integration = boot(api)
    ife.identify("user_1", {"email": "ada@example.com", "name": "Ada", "phone_number": "+1", "plan": "pro", "nested": {"a": 1}})
    req = api.by_path("/v1/events/identify")[0]
    assert req["headers"]["x-project-key"] == "pk_test"
    assert req["headers"]["content-type"] == "application/json"
    assert req["headers"]["user-agent"].startswith("iforevents-python/")
    assert req["body"] == {
        "custom_id": "user_1",
        "email": "ada@example.com",
        "name": "Ada",
        "phone_number": "+1",
        "properties": {"plan": "pro", "nested_a": 1, "device_platform": "test", "sdk_name": "iforevents-python"},
    }
    assert req["headers"]["x-user-id"] == "user_1"
    assert integration.user_id == "user_1"
    assert integration.is_identified
    ife.shutdown()


def test_02_track_after_identify_carries_uuid_and_traits(api):
    ife, _ = boot(api, batch_size=1)
    ife.identify("user_1", {"plan": "pro"})
    ife.track("clicked", {"button": "buy", "plan": "override"})
    req = api.by_path("/v1/events/track")[0]
    assert req["headers"]["x-user-id"] == "user_1"
    assert req["body"] == {"event_name": "clicked", "event_type": "track", "properties": {"plan": "override", "button": "buy", "device_platform": "test", "sdk_name": "iforevents-python"}}
    ife.shutdown()


def test_03_batch_size_n_sends_on_nth(api):
    ife, _ = boot(api, batch_size=3, flush_interval=10)
    ife.track("a")
    ife.track("b")
    time.sleep(0.02)
    assert api.requests == []
    ife.track("c")
    batches = api.by_path("/v1/events/batch")
    assert len(batches) == 1
    events = batches[0]["body"]["events"]
    assert [e["name"] for e in events] == ["a", "b", "c"]
    for e in events:
        assert e["type"] == "track"
        assert e["created_at"].endswith("Z")
    ife.shutdown()


def test_04_flush_interval_sends_partial_queue(api):
    ife, _ = boot(api, batch_size=50, flush_interval=0.05)
    ife.track("only")
    assert api.requests == []
    time.sleep(0.2)
    assert len(api.by_path("/v1/events/batch")) == 1
    ife.shutdown()


def test_05_batch_size_1_posts_track_with_event_type(api):
    ife, _ = boot(api, batch_size=1)
    ife.track("solo", {"n": 1})
    req = api.by_path("/v1/events/track")[0]
    assert req["body"]["event_type"] == "track"
    assert req["body"]["event_name"] == "solo"
    ife.shutdown()


def test_06_page_view_type_and_navigation_fields(api):
    ife, _ = boot(api, batch_size=1)
    ife.page("/pricing", {"title": "Pricing"}, navigation_type="push", previous_route="/")
    req = api.by_path("/v1/events/track")[0]
    assert req["body"] == {"event_name": "/pricing", "event_type": "page_view", "properties": {"title": "Pricing", "navigation_type": "push", "previous_route": "/"}}
    ife.shutdown()


def test_07_anonymous_id_generated_persisted_reused(api):
    storage = MemoryStorage()
    ife, integration = boot(api, batch_size=1, storage=storage)
    ife.track("first")
    ife.track("second")
    first, second = api.by_path("/v1/events/track")
    anon = first["headers"]["x-user-id"]
    assert ANON.match(anon)
    assert second["headers"]["x-user-id"] == anon
    assert integration.user_id == anon and not integration.is_identified
    assert storage.get("iforevents_user_id") == anon
    assert storage.get("iforevents_user_identified") == "false"
    again = make(api, storage=storage)
    again.init()
    assert again.user_id == anon
    other = make(api, storage=MemoryStorage())
    other.init()
    assert ANON.match(other.user_id) and other.user_id != anon
    ife.shutdown()


def test_08_reset_flushes_then_fresh_anonymous_id(api):
    storage = MemoryStorage()
    ife, integration = boot(api, batch_size=10, flush_interval=10, storage=storage)
    ife.identify("user_1")
    ife.track("before_logout")
    ife.reset()
    batches = api.by_path("/v1/events/batch")
    assert len(batches) == 1
    assert batches[0]["headers"]["x-user-id"] == "user_1"
    assert ANON.match(integration.user_id) and not integration.is_identified
    assert storage.get("iforevents_user_id") == integration.user_id
    assert storage.get("iforevents_user_identified") == "false"
    assert ife.current_traits == {}
    ife.track("after_logout")
    ife.flush()
    second = api.by_path("/v1/events/batch")[1]
    assert second["headers"]["x-user-id"] == integration.user_id != "user_1"
    ife.shutdown()


def test_09_500_then_200_retries_same_events_once(api):
    state = {"failures": 0}

    def scenario(req, handler):
        if req["path"] == "/v1/events/batch" and state["failures"] < 1:
            state["failures"] += 1
            return handler.send(500, {"error": "boom"})
        return False

    api.scenario = scenario
    ife, _ = boot(api, batch_size=2, max_retries=2)
    ife.track("x")
    ife.track("y")
    ife.flush()
    batches = api.by_path("/v1/events/batch")
    assert len(batches) == 2
    assert [e["name"] for e in batches[1]["body"]["events"]] == ["x", "y"]
    ife.shutdown()


def test_10_quota_exceeded_no_retry_drop_callback_once(api):
    state = {"refuse": True}

    def scenario(req, handler):
        if req["path"] == "/v1/events/batch" and state["refuse"]:
            return handler.send(429, {"error": "quota_exceeded", "message": "plan quota exhausted", "limit": 5000000, "used": 5000001, "org_uuid": "org-1"})
        return False

    api.scenario = scenario
    seen = []
    ife, integration = boot(api, batch_size=1000, on_quota_exceeded=seen.append)
    ife.track("a")
    ife.flush()
    ife.track("b")
    ife.flush()
    assert len(api.by_path("/v1/events/batch")) == 2
    assert len(seen) == 1
    assert isinstance(seen[0], IForeventsQuotaExceededError)
    assert (seen[0].limit, seen[0].used, seen[0].organization_uuid) == (5000000, 5000001, "org-1")
    assert integration.is_quota_exceeded
    assert integration.queued_events_count == 0
    state["refuse"] = False
    ife.track("c")
    ife.flush()
    assert not integration.is_quota_exceeded
    assert [e["name"] for e in api.by_path("/v1/events/batch")[-1]["body"]["events"]] == ["c"]
    ife.shutdown()


def test_11_rate_limit_retry_after_honored(api):
    state = {"limited": True}

    def scenario(req, handler):
        if req["path"] == "/v1/events/batch" and state["limited"]:
            state["limited"] = False
            return handler.send(429, {"error": "ingest_rate_limit_exceeded", "retry_after_seconds": 1}, {"Retry-After": "1"})
        return False

    api.scenario = scenario
    errors = []
    ife, _ = boot(api, batch_size=1000, on_error=errors.append)
    ife.track("r")
    started = time.monotonic()
    ife.flush()
    assert time.monotonic() - started >= 0.95
    assert len(api.by_path("/v1/events/batch")) == 2
    assert errors == []
    ife.shutdown()


def test_11b_rate_limit_error_typed_when_retries_exhausted(api):
    api.scenario = lambda req, h: h.send(429, {"error": "ingest_rate_limit_exceeded"}, {"Retry-After": "0"}) if req["path"] == "/v1/events/identify" else False
    errors = []
    ife, _ = boot(api, max_retries=1, on_error=errors.append)
    ife.identify("u")
    assert len(api.by_path("/v1/events/identify")) == 2
    assert isinstance(errors[0], IForeventsRateLimitedError)
    ife.shutdown()


def test_12_401_no_retry_drop_auth_error(api):
    errors = []
    integration = IForeventsAPIIntegration("pk_wrong", base_url=api.base_url, batch_size=1000, retry_delay=0.01, on_error=errors.append, flush_at_exit=False)
    ife = Iforevents([integration])
    ife.init()
    ife.track("a")
    ife.flush()
    assert len(api.by_path("/v1/events/batch")) == 1
    assert integration.queued_events_count == 0
    assert isinstance(errors[0], IForeventsAuthError)
    assert errors[0].status == 401
    ife.shutdown()


def test_13_throwing_integration_does_not_stop_api(api):
    class Broken(Integration):
        def track(self, event: TrackEvent) -> None:
            super().track(event)
            raise RuntimeError("vendor down")

    integration = make(api, batch_size=1)
    ife = Iforevents([Broken(), integration])
    ife.init()
    results = ife.track("still_delivered")
    assert [(r.integration, r.success) for r in results] == [("Broken", False), ("IForeventsAPIIntegration", True)]
    assert len(api.by_path("/v1/events/track")) == 1
    ife.shutdown()


def test_14_no_secret_anywhere(api):
    ife, _ = boot(api, batch_size=1)
    ife.identify("u", {"plan": "pro"})
    ife.track("t")
    ife.page("/p")
    for req in api.requests:
        assert "secret" not in str(req["body"]).lower()
        assert "secret" not in ",".join(req["headers"]).lower()
    with pytest.raises(ValueError, match="secret"):
        IForeventsAPIIntegration("pk", project_secret="nope")
    ife.shutdown()


def test_identify_attributes_even_when_profile_request_fails(api):
    api.scenario = lambda req, h: h.send(500, {"error": "down"}) if req["path"] == "/v1/events/identify" else False
    ife, integration = boot(api, batch_size=1, max_retries=0)
    ife.identify("user_x")
    assert integration.user_id == "user_x"
    ife.track("still_attributed")
    assert api.by_path("/v1/events/track")[0]["headers"]["x-user-id"] == "user_x"
    ife.shutdown()


def test_15_flatten():
    assert flatten({"a": {"b": {"c": 1}}, "list": [1, {"d": 2}], "plain": "x"}) == {"a_b_c": 1, "list": [1, {"d": 2}], "plain": "x"}


def test_queue_persists_across_restarts(api):
    storage = MemoryStorage()
    first = make(api, batch_size=100, flush_interval=10, storage=storage, persist_queue=True)
    first.init()
    first.track(TrackEvent(name="offline"))
    assert "offline" in storage.get("iforevents_queue")
    second = make(api, batch_size=100, flush_interval=10, storage=storage, persist_queue=True)
    second.init()
    assert second.queued_events_count == 1
    second.flush()
    assert len(api.by_path("/v1/events/batch")) == 1
    assert storage.get("iforevents_queue") is None
    first.shutdown()
    second.shutdown()


def test_calls_before_init_ignored(api):
    ife = Iforevents([make(api)])
    assert ife.track("early") == []
    assert ife.identify("u") == []
    assert api.requests == []


def test_throw_on_error_raises_and_recovers(api):
    api.scenario = lambda req, h: h.send(500, {"error": "down"})
    ife, integration = boot(api, max_retries=0, throw_on_error=True, batch_size=1000)
    with pytest.raises(Exception, match="down"):
        integration.identify(__import__("iforevents").IdentifyEvent(custom_id="u"))
    ife.track("x")
    with pytest.raises(Exception, match="down"):
        integration.flush()
    api.scenario = None
    integration.flush()
    assert len(api.by_path("/v1/events/batch")[-1]["body"]["events"]) == 1
    ife.shutdown()


def test_thread_safety_many_tracks_all_delivered(api):
    import threading

    ife, integration = boot(api, batch_size=7, flush_interval=10)
    threads = [threading.Thread(target=lambda i=i: [ife.track(f"t{i}_{n}") for n in range(20)]) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    ife.flush()
    delivered = sum(len(b["body"]["events"]) for b in api.by_path("/v1/events/batch"))
    assert delivered == 160
    assert integration.queued_events_count == 0
    ife.shutdown()
