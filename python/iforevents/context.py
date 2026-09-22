"""Default context merged into identify traits, with the Flutter key names."""
from __future__ import annotations

import platform
import socket
import sys
from typing import Any, Dict

SDK_NAME = "iforevents-python"
SDK_VERSION = "0.1.0"


def default_context(extra: Dict[str, Any] | None = None) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {
        "sdk_name": SDK_NAME,
        "sdk_version": SDK_VERSION,
        "runtime": f"python/{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "device_platform": "server",
        "device_brand": platform.system(),
        "device_model": platform.machine(),
        "device_os_version": platform.release(),
        "device_app_version": "",
        "hostname": socket.gethostname(),
    }
    if extra:
        ctx.update(extra)
    return ctx
