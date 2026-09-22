"""Base class every integration extends; mirrors the Flutter ``Integration``."""
from __future__ import annotations

from typing import Callable, Optional

from .events import IdentifyEvent, IntegrationResult, PageEvent, TrackEvent


class Integration:
    """Override what the vendor supports and call ``super()`` first so hooks run."""

    name: str = "Integration"

    def __init__(
        self,
        *,
        name: Optional[str] = None,
        on_init: Optional[Callable[[], None]] = None,
        on_identify: Optional[Callable[[IdentifyEvent], None]] = None,
        on_track: Optional[Callable[[TrackEvent], None]] = None,
        on_page: Optional[Callable[[PageEvent], None]] = None,
        on_reset: Optional[Callable[[], None]] = None,
    ) -> None:
        self.name = name or type(self).__name__
        self._on_init = on_init
        self._on_identify = on_identify
        self._on_track = on_track
        self._on_page = on_page
        self._on_reset = on_reset

    def init(self) -> None:
        if self._on_init:
            self._on_init()

    def identify(self, event: IdentifyEvent) -> None:
        if self._on_identify:
            self._on_identify(event)

    def track(self, event: TrackEvent) -> None:
        if self._on_track:
            self._on_track(event)

    def page(self, event: PageEvent) -> None:
        if self._on_page:
            self._on_page(event)

    def reset(self) -> None:
        if self._on_reset:
            self._on_reset()

    def flush(self) -> None:
        """Sends anything buffered. No-op by default."""

    def shutdown(self) -> None:
        """Flushes and releases resources. No-op by default."""


def safe_execute(integration: Integration, action: Callable[[], None]) -> IntegrationResult:
    """Runs one integration call in isolation and reports the outcome."""
    try:
        action()
        return IntegrationResult(integration=integration.name, success=True)
    except Exception as exc:  # noqa: BLE001 - every failure is reported, never raised
        return IntegrationResult(integration=integration.name, success=False, error=exc)
