// Minimal surfaces of the peer packages this SDK touches. The real type
// definitions come with the packages in the host app.
declare module "react-native" {
  export const Platform: { OS: string; Version: string | number };
  export const AppState: {
    currentState: string;
    addEventListener(type: "change", handler: (state: string) => void): { remove(): void } | void;
  };
}
declare module "@react-native-async-storage/async-storage" {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default AsyncStorage;
}
declare module "react-native-device-info" {
  const DeviceInfo: {
    getBrand(): string;
    getModel(): string;
    getSystemVersion(): string;
    getVersion(): string;
    getBuildNumber(): string;
    getUniqueId(): Promise<string>;
  };
  export default DeviceInfo;
}
