# @iforevents/amplitude

Amplitude adapter for the IForevents SDK (browser and Node.js).

```bash
npm install @iforevents/amplitude @amplitude/analytics-browser   # browser
npm install @iforevents/amplitude @amplitude/analytics-node      # node
```

```ts
import { AmplitudeIntegration } from "@iforevents/amplitude/browser";
createBrowserIforevents("pk_...", { integrations: [new AmplitudeIntegration({ apiKey: "AMPLITUDE_KEY" })] });
```

Autocapture stays off unless you pass `config: { autocapture: true }`. Pass
`client` to reuse an instance you already initialized.

MIT
