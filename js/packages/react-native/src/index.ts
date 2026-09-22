import { IForeventsAPIIntegration, Iforevents, MemoryStorage, type IForeventsAPIConfig, type Integration, type IntegrationResult, type PageOptions, type Properties, type Storage } from "@iforevents/core";
import { AppState, Platform } from "react-native";

export * from "@iforevents/core";

export const SDK_NAME = "@iforevents/react-native";
export const SDK_VERSION = "0.1.0";

/** `AsyncStorage` when installed, else memory (events still batch within the session). */
export async function pickStorage(): Promise<Storage> {
  try {
    const mod = (await import("@react-native-async-storage/async-storage")) as unknown as { default?: unknown };
    const AsyncStorage = (mod.default ?? mod) as { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
    if (typeof AsyncStorage.getItem === "function") {
      return { get: (k) => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v), remove: (k) => AsyncStorage.removeItem(k) };
    }
  } catch {
    /* optional peer missing */
  }
  return new MemoryStorage();
}

/** Device context with the Flutter key names; richer when `react-native-device-info` is installed. */
export async function reactNativeContext(extra: Properties = {}): Promise<Properties> {
  const base: Properties = {
    sdk_name: SDK_NAME,
    sdk_version: SDK_VERSION,
    runtime: "react-native",
    device_platform: Platform.OS,
    device_os_version: String(Platform.Version),
    device_brand: "",
    device_model: "",
    device_app_version: "",
  };
  try {
    const mod = (await import("react-native-device-info")) as { default?: unknown };
    const info = (mod.default ?? mod) as { getBrand(): string; getModel(): string; getSystemVersion(): string; getVersion(): string; getBuildNumber(): string };
    base.device_brand = info.getBrand();
    base.device_model = info.getModel();
    base.device_os_version = info.getSystemVersion();
    base.device_app_version = info.getVersion();
    base.device_build_number = info.getBuildNumber();
  } catch {
    /* optional peer missing */
  }
  return { ...base, ...extra };
}

export interface ReactNativeIforeventsOptions extends Omit<IForeventsAPIConfig, "projectKey" | "userAgent" | "storage"> {
  integrations?: Integration[];
  /** Extra context merged into identify traits. */
  context?: Properties;
  /** Flush when the app goes to the background. Default true. */
  flushOnBackground?: boolean;
  /** Skip the IForevents API integration. Default false. */
  disableApi?: boolean;
  /** Custom storage (defaults to AsyncStorage when installed). */
  storage?: Storage;
  onResult?: (results: IntegrationResult[]) => void;
}

export interface ReactNativeIforevents {
  iforevents: Iforevents;
  api: IForeventsAPIIntegration | null;
  /** Resolves once storage and integrations are ready; calls before it are queued. */
  ready: Promise<void>;
  track(name: string, properties?: Properties): Promise<IntegrationResult[]>;
  screen(name: string, properties?: Properties, options?: PageOptions): Promise<IntegrationResult[]>;
  identify(customId: string, traits?: Properties): Promise<IntegrationResult[]>;
  reset(): Promise<IntegrationResult[]>;
  flush(): Promise<IntegrationResult[]>;
  shutdown(): Promise<IntegrationResult[]>;
}

/**
 * Creates the client for a React Native / Expo app. The queue lives in
 * AsyncStorage so unsent events survive restarts; the app going to the
 * background triggers a flush.
 */
export function createReactNativeIforevents(projectKey: string, options: ReactNativeIforeventsOptions = {}): ReactNativeIforevents {
  const { integrations = [], context = {}, flushOnBackground = true, disableApi = false, storage, onResult, ...apiConfig } = options;
  let api: IForeventsAPIIntegration | null = null;
  const iforevents = new Iforevents({ integrations, context: () => reactNativeContext(context), debug: apiConfig.debug, logger: apiConfig.logger, onResult });

  const ready = (async () => {
    if (!disableApi) {
      api = new IForeventsAPIIntegration({ persistQueue: true, ...apiConfig, projectKey, storage: storage ?? (await pickStorage()) });
      iforevents.addIntegration(api);
      // The api integration goes last so adapters registered first keep their order.
    }
    await iforevents.init();
  })();

  let identifying: Promise<unknown> = Promise.resolve();
  const client: ReactNativeIforevents = {
    iforevents,
    get api() {
      return api;
    },
    ready,
    track: async (name, properties) => {
      await ready;
      await identifying;
      return iforevents.track(name, properties);
    },
    screen: async (name, properties, pageOptions) => {
      await ready;
      await identifying;
      return iforevents.screen(name, properties, pageOptions);
    },
    identify: async (customId, traits) => {
      await ready;
      const run = iforevents.identify(customId, traits);
      identifying = run.catch(() => undefined);
      return run;
    },
    reset: async () => {
      await ready;
      return iforevents.reset();
    },
    flush: async () => {
      await ready;
      return iforevents.flush();
    },
    shutdown: async () => {
      await ready;
      return iforevents.shutdown();
    },
  };

  if (flushOnBackground) {
    AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") void client.flush();
    });
  }
  return client;
}

/**
 * Screen tracking for `@react-navigation/native`: spread the result onto
 * `<NavigationContainer ref={ref} {...trackNavigation(client, ref)}>`.
 */
export function trackNavigation(client: Pick<ReactNativeIforevents, "screen">, ref: { current: { getCurrentRoute?: () => { name?: string } | undefined } | null }) {
  let previous: string | undefined;
  const fire = (navigationType: string) => {
    const name = ref.current?.getCurrentRoute?.()?.name;
    if (!name || name === previous) return;
    void client.screen(name, {}, { navigationType, previousRoute: previous, toRoute: name });
    previous = name;
  };
  return { onReady: () => fire("load"), onStateChange: () => fire("navigate") };
}
