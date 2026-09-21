/**
 * Key-value storage the API integration uses to persist the user uuid and the
 * pending queue. Browser packages plug `localStorage`, React Native plugs
 * AsyncStorage, servers keep the default in-memory store.
 */
export interface Storage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

/** Wraps a Web Storage object (localStorage/sessionStorage); every call is guarded. */
export class WebStorage implements Storage {
  constructor(private readonly backend: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }) {}
  get(key: string): string | null {
    try {
      return this.backend.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      this.backend.setItem(key, value);
    } catch {
      /* quota or private mode: stay in memory */
    }
  }
  remove(key: string): void {
    try {
      this.backend.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
