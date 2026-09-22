"""PostHog adapter (``pip install "iforevents[posthog]"``)."""
from __future__ import annotations

from typing import Any, Optional

from ..events import IdentifyEvent, PageEvent, TrackEvent
from ..integration import Integration
from ._vendor import load_vendor


class PostHogIntegration(Integration):
    def __init__(self, api_key: Optional[str] = None, *, host: str = "https://us.i.posthog.com", client: Any = None, anonymous_id: str = "server", **hooks: Any) -> None:
        super().__init__(name="PostHogIntegration", **hooks)
        self.api_key = api_key
        self.host = host
        self.client = client
        self.anonymous_id = anonymous_id
        self._distinct_id: Optional[str] = None

    def init(self) -> None:
        super().init()
        if self.client is None:
            if not self.api_key:
                raise ValueError("PostHogIntegration needs an api_key or a client")
            self.client = load_vendor("posthog", "posthog").Posthog(self.api_key, host=self.host)

    def _who(self) -> str:
        return self._distinct_id or self.anonymous_id

    def identify(self, event: IdentifyEvent) -> None:
        super().identify(event)
        self._distinct_id = event.custom_id
        self.client.identify(distinct_id=event.custom_id, properties=event.traits)

    def track(self, event: TrackEvent) -> None:
        super().track(event)
        self.client.capture(distinct_id=self._who(), event=event.name, properties=event.properties, timestamp=event.timestamp)

    def page(self, event: PageEvent) -> None:
        super().page(event)
        props = dict(event.properties, screen_name=event.name, navigation_type=event.navigation_type, to_route=event.to_route, previous_route=event.previous_route)
        self.client.capture(distinct_id=self._who(), event="$pageview", properties=props, timestamp=event.timestamp)

    def reset(self) -> None:
        super().reset()
        self._distinct_id = None

    def flush(self) -> None:
        self.client.flush()

    def shutdown(self) -> None:
        self.client.shutdown()
