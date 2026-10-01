import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  providerSession: vi.fn(),
  prepareProviderSession: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { connect: mocks.connect, query: mocks.poolQuery },
  transaction: vi.fn(),
}));
vi.mock("../src/config.js", () => ({
  config: { outboundEnvEnabled: true, shadowMode: false, workerId: "session-worker" },
}));
vi.mock("../src/repository.js", () => ({ providerSession: mocks.providerSession }));
vi.mock("../src/providers.js", () => ({
  isProviderAuthorizationFailure: vi.fn(() => false),
  prepareProviderSession: mocks.prepareProviderSession,
  reconcileProviderMessage: vi.fn(),
  sendProviderMessage: vi.fn(),
}));

import { withCurrentProviderSession } from "../src/delivery.js";

describe("provider session freshness at the send permit", () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.poolQuery.mockReset();
    mocks.providerSession.mockReset();
    mocks.prepareProviderSession.mockReset();
  });

  it("uses the new credential row when reauthorization replaces the prepared session before the lock", async () => {
    const oldSession = { provider: "google", credentials: { kind: "oauth", accessToken: "old-access" } };
    const newSession = { provider: "google", credentials: { kind: "oauth", accessToken: "new-access" } };
    const release = vi.fn();
    const permitClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("pg_advisory_lock_shared")) return { rows: [] };
        if (sql.includes("outreach_assert_provider_permit")) return { rows: [{ outreach_assert_provider_permit: "ledger" }] };
        if (sql.includes("pg_advisory_unlock_shared")) return { rows: [{ unlocked: true }] };
        throw new Error(`SQL inesperado: ${sql}`);
      }),
      release,
    };
    mocks.connect.mockResolvedValue(permitClient);
    mocks.providerSession
      .mockResolvedValueOnce(oldSession)
      // The callback committed a new grant while this worker waited.
      .mockResolvedValueOnce(newSession);
    mocks.prepareProviderSession.mockResolvedValue(oldSession);
    const providerCall = vi.fn(async (session: typeof newSession) => session.credentials.accessToken);

    await expect(withCurrentProviderSession(
      "00000000-0000-4000-8000-000000000100",
      "00000000-0000-4000-8000-000000000010",
      providerCall,
    )).resolves.toBe("new-access");

    expect(mocks.prepareProviderSession).toHaveBeenCalledWith(oldSession);
    expect(mocks.providerSession).toHaveBeenNthCalledWith(2, "00000000-0000-4000-8000-000000000010", permitClient);
    expect(providerCall).toHaveBeenCalledWith(newSession, permitClient);
    expect(providerCall).not.toHaveBeenCalledWith(oldSession, permitClient);
    expect(release).toHaveBeenCalledWith(undefined);
  });
});
