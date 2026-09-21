"""Amplitude adapter (``pip install "iforevents[amplitude]"``). Mirrors ``iforevents_amplitude``."""
from __future__ import annotations

from typing import Any, Optional

from ..events import IdentifyEvent, PageEvent, TrackEvent
from ..integration import Integration
from ._vendor import load_vendor, scalarize


class AmplitudeIntegration(Integration):
    def __init__(self, api_key: Optional[str] = None, *, client: Any = None, device_id: str = "server", **hooks: Any) -> None:
        super().__init__(name="AmplitudeIntegration", **hooks)
        self.api_key = api_key
        self.client = client
        self.device_id = device_id
        self._user_id: Optional[str] = None
        self._mod: Any = None

    def init(self) -> None:
        super().init()
        self._mod = load_vendor("amplitude", "amplitude")
        if self.client is None:
            if not self.api_key:
                raise ValueError("AmplitudeIntegration needs an api_key or a client")
            self.client = self._mod.Amplitude(self.api_key)

    def identify(self, event: IdentifyEvent) -> None:
        super().identify(event)
        self._user_id = event.custom_id
        identify = self._mod.Identify()
        for key, value in scalarize(event.traits).items():
            identify.set(key, value)
        self.client.identify(identify, self._mod.EventOptions(user_id=event.custom_id))

    def track(self, event: TrackEvent) -> None:
        super().track(event)
        base = self._mod.BaseEvent(
            event_type=event.name,
            user_id=self._user_id,
            device_id=None if self._user_id else self.device_id,
            event_properties=scalarize(event.properties),
            time=int(event.timestamp.timestamp() * 1000),
        )
        self.client.track(base)

    def page(self, event: PageEvent) -> None:
        super().page(event)
        props = dict(event.properties, navigation_type=event.navigation_type, to_route=event.to_route, previous_route=event.previous_route)
        self.track(TrackEvent(name=event.name or "page_view", type="page_view", properties=props, timestamp=event.timestamp))

    def reset(self) -> None:
        super().reset()
        self._user_id = None

    def flush(self) -> None:
        self.client.flush()

    def shutdown(self) -> None:
        self.client.shutdown()
