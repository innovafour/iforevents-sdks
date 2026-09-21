"""The facade: one ``init``, then ``identify``/``track``/``page``/``reset``/
``flush``/``shutdown`` fan out to every integration in isolation."""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Iterable, List, Optional, Type, TypeVar, Union

from .context import default_context
from .events import IdentifyEvent, IntegrationResult, PageEvent, Properties, TrackEvent
from .flatten import flatten
from .integration import Integration, safe_execute

log = logging.getLogger("iforevents")
T = TypeVar("T", bound=Integration)


class Iforevents:
    """Identify traits are remembered and merged under later track properties;
    nested dicts are flattened with ``_``. Mirrors the Flutter ``Iforevents``."""

    def __init__(
        self,
        integrations: Optional[Iterable[Integration]] = None,
        *,
        context: Optional[Callable[[], Properties]] = None,
        debug: bool = False,
        on_result: Optional[Callable[[List[IntegrationResult]], None]] = None,
    ) -> None:
        self._integrations: List[Integration] = list(integrations or [])
        self._context = context or default_context
        self._debug = debug
        self._on_result = on_result
        self._traits: Properties = {}
        self._initialized = False

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def current_traits(self) -> Properties:
        return dict(self._traits)

    def add_integration(self, integration: Integration) -> "Iforevents":
        self._integrations.append(integration)
        return self

    def get_integration(self, match: Union[str, Type[T]]) -> Optional[Union[Integration, T]]:
        for i in self._integrations:
            if (i.name == match) if isinstance(match, str) else isinstance(i, match):
                return i
        return None

    def init(self, integrations: Optional[Iterable[Integration]] = None) -> List[IntegrationResult]:
        if integrations:
            self._integrations.extend(integrations)
        results = self._fan_out(lambda i: i.init())
        self._initialized = True
        return results

    def identify(self, custom_id: str, traits: Optional[Properties] = None) -> List[IntegrationResult]:
        if not custom_id or not self._ready("identify"):
            return []
        merged = flatten({**self._safe_context(), **(traits or {})})
        results = self._fan_out(lambda i: i.identify(IdentifyEvent(custom_id=custom_id, traits=merged)))
        self._traits = merged
        return results

    def track(self, name: str, properties: Optional[Properties] = None) -> List[IntegrationResult]:
        if not name or not self._ready("track"):
            return []
        event = TrackEvent(name=name, properties=flatten({**self._traits, **(properties or {})}))
        return self._fan_out(lambda i: i.track(event))

    def page(
        self,
        name: Optional[str] = None,
        properties: Optional[Properties] = None,
        *,
        navigation_type: Optional[str] = None,
        to_route: Optional[str] = None,
        previous_route: Optional[str] = None,
    ) -> List[IntegrationResult]:
        if not self._ready("page"):
            return []
        event = PageEvent(name=name or "page_view", properties=flatten(properties or {}), navigation_type=navigation_type, to_route=to_route, previous_route=previous_route)
        return self._fan_out(lambda i: i.page(event))

    screen = page

    def reset(self) -> List[IntegrationResult]:
        if not self._ready("reset"):
            return []
        results = self._fan_out(lambda i: i.reset())
        self._traits = {}
        return results

    def flush(self) -> List[IntegrationResult]:
        return self._fan_out(lambda i: i.flush())

    def shutdown(self) -> List[IntegrationResult]:
        results = self._fan_out(lambda i: i.shutdown())
        self._initialized = False
        return results

    # --- internals ----------------------------------------------------------------

    def _ready(self, method: str) -> bool:
        if self._initialized:
            return True
        if self._debug:
            log.warning("[iforevents] %s called before init; ignored", method)
        return False

    def _safe_context(self) -> Properties:
        try:
            return self._context() or {}
        except Exception as exc:  # noqa: BLE001
            if self._debug:
                log.warning("[iforevents] context provider failed: %s", exc)
            return {}

    def _fan_out(self, action: Callable[[Integration], Any]) -> List[IntegrationResult]:
        results = [safe_execute(i, lambda i=i: action(i)) for i in self._integrations]
        if self._debug:
            for r in results:
                if not r.success:
                    log.warning("[iforevents] %s failed: %s", r.integration, r.error)
        if self._on_result:
            self._on_result(results)
        return results
