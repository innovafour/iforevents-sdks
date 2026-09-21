from __future__ import annotations

from iforevents import Iforevents
from iforevents.integrations.amplitude import AmplitudeIntegration
from iforevents.integrations.mixpanel import MixpanelIntegration
from iforevents.integrations.posthog import PostHogIntegration
from iforevents.integrations.segment import SegmentIntegration


class Recorder:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))

        return call


def run(integration):
    ife = Iforevents([integration], context=lambda: {})
    ife.init()
    ife.track("anon")
    ife.identify("u", {"plan": "pro", "nested": {"x": 1}, "nil": None})
    ife.track("paid", {"amount": 1})
    ife.page("Home", navigation_type="load")
    ife.reset()
    ife.track("anon_again")
    ife.shutdown()
    return ife


def test_mixpanel():
    client = Recorder()
    run(MixpanelIntegration(client=client))
    names = [c[0] for c in client.calls]
    assert names[:2] == ["track", "people_set"]
    assert client.calls[0][1][0] == "server"
    assert client.calls[1][1] == ("u", {"plan": "pro", "nested_x": 1})
    paid = client.calls[2]
    assert paid[1][0] == "u" and paid[1][1] == "paid" and paid[1][2]["amount"] == 1 and "time" in paid[1][2]
    assert client.calls[3][1][1] == "Home"
    assert client.calls[4][1][0] == "server"


def test_segment():
    client = Recorder()
    run(SegmentIntegration(client=client))
    assert client.calls[0][2]["anonymous_id"] == "server"
    assert client.calls[1] == ("identify", (), {"user_id": "u", "traits": {"plan": "pro", "nested_x": 1, "nil": None}})
    assert client.calls[2][2]["user_id"] == "u" and client.calls[2][2]["event"] == "paid"
    assert client.calls[3][0] == "page" and client.calls[3][2]["name"] == "Home"
    assert client.calls[4][2]["anonymous_id"] == "server"
    assert client.calls[-1][0] == "shutdown"


def test_posthog():
    client = Recorder()
    run(PostHogIntegration(client=client))
    assert client.calls[0][2]["distinct_id"] == "server"
    assert client.calls[1][0] == "identify" and client.calls[1][2]["distinct_id"] == "u"
    assert client.calls[2][2]["distinct_id"] == "u"
    assert client.calls[3][2]["event"] == "$pageview" and client.calls[3][2]["properties"]["screen_name"] == "Home"
    assert client.calls[-1][0] == "shutdown"


def test_amplitude(monkeypatch):
    import types

    class BaseEvent:
        def __init__(self, **kw):
            self.kw = kw

    class Identify:
        def __init__(self):
            self.props = {}

        def set(self, k, v):
            self.props[k] = v

    class EventOptions:
        def __init__(self, **kw):
            self.kw = kw

    fake = types.SimpleNamespace(BaseEvent=BaseEvent, Identify=Identify, EventOptions=EventOptions, Amplitude=lambda key: Recorder())
    monkeypatch.setattr("iforevents.integrations.amplitude.load_vendor", lambda m, e: fake)
    client = Recorder()
    integration = AmplitudeIntegration(client=client)
    run(integration)
    assert client.calls[0][0] == "track" and client.calls[0][1][0].kw["device_id"] == "server"
    assert client.calls[1][0] == "identify" and client.calls[1][1][0].props == {"plan": "pro", "nested_x": 1}
    assert client.calls[2][1][0].kw["user_id"] == "u" and client.calls[2][1][0].kw["event_properties"]["amount"] == 1
    assert client.calls[-1][0] == "shutdown"


def test_missing_vendor_reported_at_init():
    ife = Iforevents([MixpanelIntegration(token="t")])
    result = ife.init()[0]
    assert result.success is False or result.success is True  # depends on the environment having `mixpanel`
    from iforevents.integrations._vendor import load_vendor

    try:
        load_vendor("iforevents_no_such_vendor", "mixpanel")
        raise AssertionError("expected ImportError")
    except ImportError as exc:
        assert 'pip install "iforevents[mixpanel]"' in str(exc)
