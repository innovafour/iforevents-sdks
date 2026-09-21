"""Segment adapter (``pip install "iforevents[segment]"``). Mirrors ``iforevents_segment``."""
from __future__ import annotations

from typing import Any, Dict, Optional

from ..events import IdentifyEvent, PageEvent, TrackEvent
from ..integration import Integration
from ._vendor import load_vendor


class SegmentIntegration(Integration):
    def __init__(self, write_key: Optional[str] = None, *, client: Any = None, anonymous_id: str = "server", **hooks: Any) -> None:
        super().__init__(name="SegmentIntegration", **hooks)
        self.write_key = write_key
        self.client = client
        self.anonymous_id = anonymous_id
        self._user_id: Optional[str] = None

    def init(self) -> None:
        super().init()
        if self.client is None:
            if not self.write_key:
                raise ValueError("SegmentIntegration needs a write_key or a client")
            self.client = load_vendor("segment.analytics", "segment").Client(self.write_key)

    def _who(self) -> Dict[str, Any]:
        return {"user_id": self._user_id} if self._user_id else {"anonymous_id": self.anonymous_id}

    def identify(self, event: IdentifyEvent) -> None:
        super().identify(event)
        self._user_id = event.custom_id
        self.client.identify(user_id=event.custom_id, traits=event.traits)

    def track(self, event: TrackEvent) -> None:
        super().track(event)
        self.client.track(event=event.name, properties=event.properties, timestamp=event.timestamp, **self._who())

    def page(self, event: PageEvent) -> None:
        super().page(event)
        props = dict(event.properties, navigation_type=event.navigation_type, to_route=event.to_route, previous_route=event.previous_route)
        self.client.page(name=event.name, properties=props, timestamp=event.timestamp, **self._who())

    def reset(self) -> None:
        super().reset()
        self._user_id = None

    def flush(self) -> None:
        self.client.flush()

    def shutdown(self) -> None:
        self.client.shutdown()
