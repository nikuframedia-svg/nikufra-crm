import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { auth } }));

import { outreachRequest } from "./api";

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
  auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh-token" } }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Outreach expired CRM session", () => {
  it("refreshes once and retries the same request with the new token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: "invalid_session", message: "Expired" } }, 401))
      .mockResolvedValueOnce(json({ data: { added: 1 } }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(outreachRequest("/audiences/one/recipients", {
      method: "POST",
      body: JSON.stringify({ contactIds: ["lead"] }),
      headers: { "Idempotency-Key": "same-operation" },
    })).resolves.toEqual({ added: 1 });

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((call) => call[1]);
    expect((first.headers as Headers).get("Authorization")).toBe("Bearer old-token");
    expect((second.headers as Headers).get("Authorization")).toBe("Bearer fresh-token");
    expect((second.headers as Headers).get("Idempotency-Key")).toBe("same-operation");
    expect(second.body).toBe(first.body);
  });

  it("asks for a new login when the refresh token is invalid", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("revoked") });
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: "invalid_session" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(outreachRequest("/verifications", { method: "POST" }))
      .rejects.toMatchObject({ status: 401, code: "invalid_session", message: expect.stringContaining("Entra novamente") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
