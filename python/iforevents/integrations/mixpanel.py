"""Mixpanel adapter (``pip install "iforevents[mixpanel]"``). Mirrors ``iforevents_mixpanel``."""
from __future__ import annotations

from typing import Any, Optional

from ..events import IdentifyEvent, PageEvent, TrackEvent
from ..integration import Integration
from ._vendor import load_vendor, scalarize


class MixpanelIntegration(Integration):
    """The distinct id is the last identified ``custom_id``; anonymous events use ``anonymous_id``."""

    def __init__(self, token: Optional[str] = None, *, client: Any = None, anonymous_id: str = "server", **hooks: Any) -> None:
        super().__init__(name="MixpanelIntegration", **hooks)
        self.token = token
        self.client = client
        self.anonymous_id = anonymous_id
        self._distinct_id: Optional[str] = None

    def init(self) -> None:
        super().init()
        if self.client is None:
            if not self.token:
                raise ValueError("MixpanelIntegration needs a token or a client")
            self.client = load_vendor("mixpanel", "mixpanel").Mixpanel(self.token)

    def _who(self) -> str:
        return self._distinct_id or self.anonymous_id

    def identify(self, event: IdentifyEvent) -> None:
        super().identify(event)
        self._distinct_id = event.custom_id
        self.client.people_set(event.custom_id, scalarize(event.traits))

    def track(self, event: TrackEvent) -> None:
        super().track(event)
        props = scalarize(event.properties)
        props["time"] = int(event.timestamp.timestamp())
        self.client.track(self._who(), event.name, props)

    def page(self, event: PageEvent) -> None:
        super().page(event)
        props = dict(event.properties, navigation_type=event.navigation_type, to_route=event.to_route, previous_route=event.previous_route)
        self.track(TrackEvent(name=event.name or "page_view", type="page_view", properties=props, timestamp=event.timestamp))

    def reset(self) -> None:
        super().reset()
        self._distinct_id = None
