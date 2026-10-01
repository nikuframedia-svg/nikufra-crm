import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  config: { outboundEnvEnabled: true, shadowMode: false, workerId: "permit-worker" },
}));
vi.mock("../src/db.js", () => ({
  pool: { connect: mocks.connect, query: mocks.poolQuery },
  transaction: vi.fn(),
}));

import { OUTBOUND_SEND_GATE, withOutboundProviderPermit } from "../src/delivery.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("provider-boundary permit ordering", () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.poolQuery.mockReset();
  });

  it("makes a send wait for a winning trip/suppression and recheck to zero provider calls", async () => {
    const writerCommit = deferred<{ rows: never[] }>();
    const gateError = Object.assign(new Error("Permit recusado após supressão"), { code: "P2003" });
    const providerCall = vi.fn();
    const release = vi.fn();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("pg_advisory_lock_shared")) return writerCommit.promise;
      if (sql.includes("outreach_assert_provider_permit")) throw gateError;
      if (sql.includes("pg_advisory_unlock_shared")) return { rows: [{ unlocked: true }] };
      throw new Error(`SQL inesperado: ${sql} ${JSON.stringify(params)}`);
    });
    mocks.connect.mockResolvedValue({ query, release });

    const send = withOutboundProviderPermit("job-after-writer", providerCall);
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(providerCall).not.toHaveBeenCalled();

    // The exclusive writer commits first; only then can the shared lock resolve
    // and the full eligibility recheck observe its suppression/kill mutation.
    writerCommit.resolve({ rows: [] });
    await expect(send).rejects.toMatchObject({ code: "P2003" });

    expect(providerCall).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([...OUTBOUND_SEND_GATE]);
    expect(String(query.mock.calls[1]?.[0])).toContain("outreach_assert_provider_permit");
    expect(String(query.mock.calls[2]?.[0])).toContain("pg_advisory_unlock_shared");
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it("lets a provider call with the shared permit finish before a waiting writer commits", async () => {
    const providerResponse = deferred<string>();
    const writerCommit = deferred<void>();
    const order: string[] = [];
    const release = vi.fn();
    let permitHeld = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_lock_shared")) {
        permitHeld = true;
        order.push("permit_acquired");
        return { rows: [] };
      }
      if (sql.includes("outreach_assert_provider_permit")) {
        order.push("eligibility_rechecked");
        return { rows: [{ outreach_assert_provider_permit: "ledger-id" }] };
      }
      if (sql.includes("pg_advisory_unlock_shared")) {
        permitHeld = false;
        order.push("permit_released");
        writerCommit.resolve();
        return { rows: [{ unlocked: true }] };
      }
      throw new Error(`SQL inesperado: ${sql}`);
    });
    mocks.connect.mockResolvedValue({ query, release });
    const providerCall = vi.fn(async () => {
      order.push("provider_started");
      const value = await providerResponse.promise;
      order.push("provider_returned");
      return value;
    });

    const send = withOutboundProviderPermit("job-before-writer", providerCall);
    await vi.waitFor(() => expect(providerCall).toHaveBeenCalledOnce());
    expect(permitHeld).toBe(true);

    let writerCommitted = false;
    const writer = writerCommit.promise.then(() => {
      writerCommitted = true;
      order.push("writer_committed");
    });
    await Promise.resolve();
    expect(writerCommitted).toBe(false);

    providerResponse.resolve("provider-receipt");
    await expect(send).resolves.toBe("provider-receipt");
    await writer;

    expect(order).toEqual([
      "permit_acquired",
      "eligibility_rechecked",
      "provider_started",
      "provider_returned",
      "permit_released",
      "writer_committed",
    ]);
    expect(release).toHaveBeenCalledWith(undefined);
  });
});
