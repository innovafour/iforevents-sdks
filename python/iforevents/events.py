"""Event models shared by the facade and every integration."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

Properties = Dict[str, Any]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class IdentifyEvent:
    """The app's own user id plus traits (context merged, nested maps flattened)."""

    custom_id: str
    traits: Properties = field(default_factory=dict)


@dataclass
class TrackEvent:
    """A tracked event ready for every integration. ``type`` is ``track`` or ``page_view``."""

    name: str
    properties: Properties = field(default_factory=dict)
    type: str = "track"
    timestamp: datetime = field(default_factory=utcnow)


@dataclass
class PageEvent:
    """A page (web) or screen (mobile) view."""

    name: str = "page_view"
    properties: Properties = field(default_factory=dict)
    navigation_type: Optional[str] = None
    to_route: Optional[str] = None
    previous_route: Optional[str] = None
    timestamp: datetime = field(default_factory=utcnow)


@dataclass
class IntegrationResult:
    """Outcome of one integration call; the facade never raises for these."""

    integration: str
    success: bool
    error: Optional[BaseException] = None
    timestamp: datetime = field(default_factory=utcnow)
