# @iforevents/next

Next.js bindings for the IForevents analytics SDK.

## App Router (client)

```tsx
// app/layout.tsx
import { IforeventsProvider } from "@iforevents/next";

export default function RootLayout({ children }) {
  return (
    <html><body>
      <IforeventsProvider projectKey={process.env.NEXT_PUBLIC_IFOREVENTS_PROJECT_KEY!}>
        {children}
      </IforeventsProvider>
    </body></html>
  );
}
```

Page views are sent on every navigation. In client components use
`useTrack()`, `useIdentify()` and `useIforevents()` from the same package.

## Server (route handlers, server actions)

```ts
import { getServerIforevents } from "@iforevents/next/server";

export async function POST() {
  const { iforevents } = await getServerIforevents({ projectKey: process.env.IFOREVENTS_PROJECT_KEY! });
  await iforevents.track("order_created", { total: 42 });
  return Response.json({ ok: true });
}
```

The project key is public; `NEXT_PUBLIC_` exposure is intended.

MIT
