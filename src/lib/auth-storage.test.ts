import { describe, expect, it } from "vitest";
import { createRememberedAuthStorage, REMEMBER_GOOGLE_ACCOUNT_KEY, setRememberGoogleAccount, shouldRememberGoogleAccount } from "./auth-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("remembered browser authentication", () => {
  it("remembers the Google account by default", () => {
    const local = memoryStorage();
    expect(shouldRememberGoogleAccount(local)).toBe(true);

    const session = memoryStorage();
    const storage = createRememberedAuthStorage(local, session);
    storage.setItem("auth-token", "persistent-session");

    expect(local.getItem("auth-token")).toBe("persistent-session");
    expect(session.getItem("auth-token")).toBeNull();
  });

  it("uses only the current tab session when remembering is disabled", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    setRememberGoogleAccount(false, local);
    expect(local.getItem(REMEMBER_GOOGLE_ACCOUNT_KEY)).toBe("false");

    const storage = createRememberedAuthStorage(local, session);
    storage.setItem("auth-token", "temporary-session");

    expect(local.getItem("auth-token")).toBeNull();
    expect(session.getItem("auth-token")).toBe("temporary-session");
  });

  it("clears both persistent and temporary copies on explicit sign-out", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    local.setItem("auth-token", "old");
    session.setItem("auth-token", "current");

    const storage = createRememberedAuthStorage(local, session);
    storage.removeItem("auth-token");

    expect(local.getItem("auth-token")).toBeNull();
    expect(session.getItem("auth-token")).toBeNull();
  });
});
