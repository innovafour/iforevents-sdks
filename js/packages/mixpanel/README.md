# @iforevents/mixpanel

Mixpanel adapter for the IForevents SDK. Every `identify`, `track`, `page`
and `reset` you send through IForevents is forwarded to Mixpanel as well.

```bash
npm install @iforevents/mixpanel mixpanel-browser   # browser
npm install @iforevents/mixpanel mixpanel           # node
```

```ts
import { createBrowserIforevents } from "@iforevents/browser";
import { MixpanelIntegration } from "@iforevents/mixpanel/browser";

createBrowserIforevents("pk_...", { integrations: [new MixpanelIntegration({ token: "MIXPANEL_TOKEN" })] });
```

```ts
import { createIforevents } from "@iforevents/node";
import { MixpanelIntegration } from "@iforevents/mixpanel/node";

await createIforevents({ projectKey, integrations: [new MixpanelIntegration({ token: "MIXPANEL_TOKEN" })] });
```

Pass `client` instead of `token` to reuse an instance you already initialized.

MIT
