import { invoke } from "@tauri-apps/api/core";

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function supportsNativeAuthStorage() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const platform = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  return /mac|windows|win32|win64/i.test(platform);
}

export function createSecureAuthStorage(): AuthStorage | undefined {
  if (!supportsNativeAuthStorage()) return undefined;

  const call = <T>(command: string, payload: Record<string, string>) => invoke<T>(command, payload);

  return {
    getItem: (key) => call<string | null>("secure_storage_get", { key }),
    setItem: (key, value) => call<void>("secure_storage_set", { key, value }),
    removeItem: (key) => call<void>("secure_storage_remove", { key }),
  };
}
