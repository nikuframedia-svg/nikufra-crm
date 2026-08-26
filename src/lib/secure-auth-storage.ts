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
  const values = new Map<string, string | null>();
  const pendingReads = new Map<string, Promise<string | null>>();

  return {
    getItem(key) {
      if (values.has(key)) return Promise.resolve(values.get(key) ?? null);
      const pending = pendingReads.get(key);
      if (pending) return pending;

      const read = call<string | null>("secure_storage_get", { key })
        .then((value) => {
          values.set(key, value);
          return value;
        })
        .catch((error: unknown) => {
          // Supabase polls storage while refreshing a session. Cache a denied
          // Keychain read for this app run so macOS cannot open a prompt every
          // refresh cycle after an ad-hoc internal build changes its code hash.
          console.error("Não foi possível ler a sessão segura nesta execução.", error);
          values.set(key, null);
          return null;
        })
        .finally(() => pendingReads.delete(key));
      pendingReads.set(key, read);
      return read;
    },
    async setItem(key, value) {
      values.set(key, value);
      await call<void>("secure_storage_set", { key, value });
    },
    async removeItem(key) {
      values.set(key, null);
      await call<void>("secure_storage_remove", { key });
    },
  };
}
