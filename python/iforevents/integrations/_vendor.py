from __future__ import annotations

import importlib
from typing import Any, Dict


def load_vendor(module: str, extra: str) -> Any:
    try:
        return importlib.import_module(module)
    except ImportError as exc:
        raise ImportError(f'{module} is not installed; run: pip install "iforevents[{extra}]"') from exc


def scalarize(properties: Dict[str, Any]) -> Dict[str, Any]:
    """Vendors reject None and nested objects; keep scalars, stringify the rest."""
    out: Dict[str, Any] = {}
    for key, value in properties.items():
        if value is None:
            continue
        out[key] = value if isinstance(value, (str, int, float, bool)) else str(value)
    return out
