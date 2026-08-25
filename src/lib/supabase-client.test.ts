import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  signInWithOtp: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn(() => ({ auth })));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://crm.nikufra.ai");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {}, location: { origin: "tauri://localhost" } },
  });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.setSession.mockResolvedValue({ error: null });
  auth.signInWithOtp.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "window");
});

describe("secure desktop authentication", () => {
  it("enables persistent PKCE sessions and refuses implicit account creation", async () => {
    const { requestMagicLink } = await import("./supabase");

    expect(createClient).toHaveBeenCalledWith("https://crm.nikufra.ai", "public-anon-key", {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        experimental: { appendPkceFlowIdToRedirects: true },
      },
    });

    await requestMagicLink("member@gmail.com");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "member@gmail.com",
      options: {
        emailRedirectTo: "nikufra-crm://auth/callback",
        shouldCreateUser: false,
      },
    });
  });

  it("exchanges a one-time PKCE code bound to the originating flow", async () => {
    const { consumeAppDeepLink } = await import("./supabase");

    await expect(consumeAppDeepLink(
      "nikufra-crm://auth/callback?code=one-time-code&sb_flow_id=12345678abcdef",
    )).resolves.toBe("auth");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code", { flowId: "12345678abcdef" });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("accepts already-issued invite links during the transition", async () => {
    const { consumeAppDeepLink } = await import("./supabase");

    await expect(consumeAppDeepLink(
      "nikufra-crm://auth/callback#access_token=access&refresh_token=refresh",
    )).resolves.toBe("auth");
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
  });
});
