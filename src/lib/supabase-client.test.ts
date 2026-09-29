import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
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
    value: {
      location: { origin: "https://crm.nikufra.ai" },
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
      sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    },
  });
  auth.signInWithOtp.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "window");
});

describe("secure browser authentication", () => {
  it("uses persistent PKCE sessions and lets Supabase consume the callback URL", async () => {
    const { requestMagicLink } = await import("./supabase");

    expect(createClient).toHaveBeenCalledWith("https://crm.nikufra.ai", "public-anon-key", {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        experimental: { appendPkceFlowIdToRedirects: true },
        storage: expect.objectContaining({ getItem: expect.any(Function), setItem: expect.any(Function), removeItem: expect.any(Function) }),
      },
    });

    await requestMagicLink("member@gmail.com");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "member@gmail.com",
      options: {
        emailRedirectTo: "https://crm.nikufra.ai",
        shouldCreateUser: false,
      },
    });
  });

  it("propagates an authentication error", async () => {
    auth.signInWithOtp.mockResolvedValueOnce({ error: new Error("email unavailable") });
    const { requestMagicLink } = await import("./supabase");

    await expect(requestMagicLink("member@gmail.com")).rejects.toThrow("email unavailable");
  });
});
