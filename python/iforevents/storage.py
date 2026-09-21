"""Key-value storage for the user uuid (and the queue when persisted)."""
from __future__ import annotations

import json
import os
import threading
from typing import Dict, Optional, Protocol


class Storage(Protocol):
    def get(self, key: str) -> Optional[str]: ...

    def set(self, key: str, value: str) -> None: ...

    def remove(self, key: str) -> None: ...


class MemoryStorage:
    def __init__(self) -> None:
        self._data: Dict[str, str] = {}

    def get(self, key: str) -> Optional[str]:
        return self._data.get(key)

    def set(self, key: str, value: str) -> None:
        self._data[key] = value

    def remove(self, key: str) -> None:
        self._data.pop(key, None)


class FileStorage:
    """A JSON file, for CLIs and desktop apps that want the queue to survive restarts."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> Dict[str, str]:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, data: Dict[str, str]) -> None:
        tmp = f"{self.path}.tmp"
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, self.path)

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            return self._read().get(key)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            data = self._read()
            data[key] = value
            self._write(data)

    def remove(self, key: str) -> None:
        with self._lock:
            data = self._read()
            if key in data:
                del data[key]
                self._write(data)
