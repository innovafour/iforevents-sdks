"""Real-api smoke: IFOREVENTS_PROJECT_KEY and IFOREVENTS_BASE_URL must be set."""
import json
import os
import sys
import time

from iforevents import IForeventsAPIIntegration, Iforevents

key = os.environ.get("IFOREVENTS_PROJECT_KEY")
base = os.environ.get("IFOREVENTS_BASE_URL", "https://api.iforevents.com")
if not key:
    print("IFOREVENTS_PROJECT_KEY missing", file=sys.stderr)
    sys.exit(2)
errors = []
api = IForeventsAPIIntegration(key, base_url=base, batch_size=2, on_error=lambda e: errors.append(str(e)))
ife = Iforevents([api])
ife.init()
ident = ife.identify(f"smoke_py_{int(time.time())}", {"email": "smoke@example.com", "plan": "free", "nested": {"deep": True}})
ife.track("smoke_track", {"n": 1})
ife.page("/smoke")
ife.shutdown()
print(json.dumps({"identify": ident[0].success, "user_id": api.user_id, "queued": api.queued_events_count, "errors": errors}))
sys.exit(0 if ident[0].success and not errors and api.user_id else 1)
