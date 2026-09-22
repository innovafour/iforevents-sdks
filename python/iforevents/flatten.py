"""Nested dict flattening with ``_``, as the Flutter package does."""
from __future__ import annotations

from typing import Any, Dict


def flatten(data: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """``{"a": {"b": 1}}`` becomes ``{"a_b": 1}``; lists and other values are kept."""
    out: Dict[str, Any] = {}
    for key, value in data.items():
        name = f"{prefix}_{key}" if prefix else str(key)
        if isinstance(value, dict):
            out.update(flatten(value, name))
        else:
            out[name] = value
    return out
