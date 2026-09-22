# @iforevents/segment

Segment adapter for the IForevents SDK (browser `@segment/analytics-next`,
Node.js `@segment/analytics-node`).

```ts
import { SegmentIntegration } from "@iforevents/segment/browser";
createBrowserIforevents("pk_...", { integrations: [new SegmentIntegration({ writeKey: "SEGMENT_WRITE_KEY" })] });
```

MIT
