# @iforevents/react-native

IForevents analytics for React Native and Expo. Device context, a queue in
AsyncStorage that survives restarts, flush on background, and screen
tracking for React Navigation. Adapters from `@iforevents/*` work here too
(use their `/browser` entries or the vendor's RN package with `client`).

```bash
npm install @iforevents/react-native @react-native-async-storage/async-storage
# optional, richer device context:
npm install react-native-device-info
```

```tsx
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createReactNativeIforevents, trackNavigation } from "@iforevents/react-native";

export const analytics = createReactNativeIforevents("pk_...");
const navRef = createNavigationContainerRef();

export default function App() {
  return (
    <NavigationContainer ref={navRef} {...trackNavigation(analytics, navRef)}>
      {/* screens */}
    </NavigationContainer>
  );
}

// anywhere
await analytics.identify("user_123", { plan: "pro" });
await analytics.track("purchase_completed", { total: 9.99 });
```

MIT
