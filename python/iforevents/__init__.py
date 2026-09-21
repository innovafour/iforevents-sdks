"""IForevents analytics SDK for Python."""
from .api import IForeventsAPIIntegration, anonymous_id
from .client import Iforevents
from .context import SDK_NAME, SDK_VERSION, default_context
from .errors import IForeventsAPIError, IForeventsAuthError, IForeventsQuotaExceededError, IForeventsRateLimitedError, classify_response
from .events import IdentifyEvent, IntegrationResult, PageEvent, Properties, TrackEvent
from .flatten import flatten
from .integration import Integration, safe_execute
from .storage import FileStorage, MemoryStorage, Storage

__version__ = SDK_VERSION
__all__ = [
    "Iforevents",
    "Integration",
    "IForeventsAPIIntegration",
    "anonymous_id",
    "IForeventsAPIError",
    "IForeventsAuthError",
    "IForeventsQuotaExceededError",
    "IForeventsRateLimitedError",
    "IdentifyEvent",
    "TrackEvent",
    "PageEvent",
    "IntegrationResult",
    "Properties",
    "Storage",
    "MemoryStorage",
    "FileStorage",
    "flatten",
    "safe_execute",
    "classify_response",
    "default_context",
    "SDK_NAME",
    "SDK_VERSION",
]
