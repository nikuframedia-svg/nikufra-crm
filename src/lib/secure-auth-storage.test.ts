import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecureAuthStorage, supportsNativeAuthStorage } from "./secure-auth-storage";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  vi.clearAllMocks();
});

describe("native auth storage boundary", () => {
  it("does not expose native credential commands to the web fallback", () => {
    expect(supportsNativeAuthStorage()).toBe(false);
    expect(createSecureAuthStorage()).toBeUndefined();
  });

  it("does not use unavailable desktop keychains on Linux", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    expect(supportsNativeAuthStorage()).toBe(false);
  });

  it("routes desktop session operations only through the native credential commands", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "MacIntel", userAgent: "Nikufra CRM macOS" },
    });
    invoke.mockResolvedValueOnce("stored-session").mockResolvedValue(undefined);

    const storage = createSecureAuthStorage();
    await expect(storage?.getItem("sb-crm-auth-token")).resolves.toBe("stored-session");
    await expect(storage?.getItem("sb-crm-auth-token")).resolves.toBe("stored-session");
    await storage?.setItem("sb-crm-auth-token", "new-session");
    await storage?.removeItem("sb-crm-auth-token");

    expect(invoke.mock.calls).toEqual([
      ["secure_storage_get", { key: "sb-crm-auth-token" }],
      ["secure_storage_set", { key: "sb-crm-auth-token", value: "new-session" }],
      ["secure_storage_remove", { key: "sb-crm-auth-token" }],
    ]);
  });

  it("does not reopen a denied Keychain prompt on every session refresh", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "MacIntel", userAgent: "Nikufra CRM macOS" },
    });
    invoke.mockRejectedValueOnce(new Error("Acesso ao Keychain recusado"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const storage = createSecureAuthStorage();
    await expect(storage?.getItem("sb-crm-auth-token")).resolves.toBeNull();
    await expect(storage?.getItem("sb-crm-auth-token")).resolves.toBeNull();

    expect(invoke).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
