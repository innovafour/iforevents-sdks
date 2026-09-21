"""Tiny ingest api double: records requests, answers like the real api, supports fault injection."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional

Scenario = Callable[[Dict[str, Any], "Handler"], bool]


class MockApi:
    def __init__(self) -> None:
        self.requests: List[Dict[str, Any]] = []
        self.scenario: Optional[Scenario] = None
        self.lock = threading.Lock()
        api = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # silence
                pass

            def send(self, status: int, body: Any, headers: Optional[Dict[str, str]] = None) -> bool:
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return True

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode() if length else ""
                body = json.loads(raw) if raw else {}
                rec = {"method": "POST", "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}
                with api.lock:
                    api.requests.append(rec)
                    scenario = api.scenario
                if scenario and scenario(rec, self):
                    return
                if rec["headers"].get("x-project-key") != "pk_test":
                    self.send(401, {"error": "invalid project key"})
                    return
                if self.path == "/v1/events/identify":
                    self.send(201, {"user": {"uuid": "11111111-1111-4111-8111-111111111111", "custom_id": body.get("custom_id")}})
                elif self.path == "/v1/events/track":
                    self.send(201, {"status": "ok", "user_uuid": "22222222-2222-4222-8222-222222222222"})
                elif self.path == "/v1/events/batch":
                    self.send(202, {"status": "queued", "user_uuid": "33333333-3333-4333-8333-333333333333"})
                else:
                    self.send(404, {"error": "not found"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def reset(self) -> None:
        with self.lock:
            self.requests.clear()
            self.scenario = None

    def by_path(self, path: str) -> List[Dict[str, Any]]:
        with self.lock:
            return [r for r in self.requests if r["path"] == path]
