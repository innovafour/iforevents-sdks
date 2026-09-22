# @iforevents/react

React bindings for the IForevents analytics SDK.

```bash
npm install @iforevents/react
```

```tsx
import { IforeventsProvider, useTrack, usePageView } from "@iforevents/react";
import { useLocation } from "react-router-dom";

function PageViews() {
  usePageView(useLocation().pathname); // one page view per route change
  return null;
}

export function App() {
  return (
    <IforeventsProvider projectKey="pk_..." options={{ integrations: [] }}>
      <PageViews />
      <Checkout />
    </IforeventsProvider>
  );
}

function Checkout() {
  const track = useTrack();
  return <button onClick={() => track("checkout_started", { items: 3 })}>Buy</button>;
}
```

Hooks: `useIforevents()`, `useTrack()`, `useIdentify()`, `usePageView(path?, props?)`.
The provider accepts `client` to reuse a client you created elsewhere.

MIT
