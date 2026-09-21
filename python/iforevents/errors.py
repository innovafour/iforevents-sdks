"""Typed errors of the API integration.

Every api failure body is ``{"error": <code or message>, "message"?: ...}``.
``AuthError`` and ``QuotaExceededError`` are permanent: their events are
dropped, not re-queued.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


class IForeventsAPIError(Exception):
    """Base class: a request failed after retries."""

    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details

    @property
    def retryable(self) -> bool:
        return self.status is None or self.status >= 500


class IForeventsAuthError(IForeventsAPIError):
    """Project key unknown, rotated, or project disabled (401/403)."""

    @property
    def retryable(self) -> bool:
        return False


class IForeventsQuotaExceededError(IForeventsAPIError):
    """Monthly plan quota exhausted (429 ``quota_exceeded``)."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None, limit: Optional[int] = None, used: Optional[int] = None, organization_uuid: Optional[str] = None):
        super().__init__(message, status=429, code="quota_exceeded", details=details)
        self.limit = limit
        self.used = used
        self.organization_uuid = organization_uuid

    @property
    def retryable(self) -> bool:
        return False


class IForeventsRateLimitedError(IForeventsAPIError):
    """Too many requests in a short window (429 without a quota code); retried after ``retry_after``."""

    def __init__(self, message: str, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None, retry_after: Optional[float] = None):
        super().__init__(message, status=429, code=code, details=details)
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        return True


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def classify_response(status: int, body: Any, retry_after_header: Optional[str]) -> IForeventsAPIError:
    """Builds the typed error for an HTTP answer."""
    details = body if isinstance(body, dict) else None
    code = details.get("error") if details and isinstance(details.get("error"), str) else None
    message = str((details or {}).get("message") or code or f"request failed with status {status}")

    if status == 429 and code == "quota_exceeded":
        limit = _as_number(details.get("limit")) if details else None
        used = _as_number(details.get("used")) if details else None
        return IForeventsQuotaExceededError(
            message,
            details=details,
            limit=int(limit) if limit is not None else None,
            used=int(used) if used is not None else None,
            organization_uuid=details.get("org_uuid") if details else None,
        )
    if status == 429:
        seconds = _as_number(retry_after_header) if retry_after_header else None
        if seconds is None and details:
            seconds = _as_number(details.get("retry_after_seconds"))
        return IForeventsRateLimitedError(message, code=code, details=details, retry_after=seconds)
    if status in (401, 403):
        return IForeventsAuthError(message, status=status, code=code, details=details)
    return IForeventsAPIError(message, status=status, code=code, details=details)
