import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  transaction: vi.fn(),
  sendProviderMessage: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  config: {
    outboundEnvEnabled: true,
    shadowMode: true,
    workerId: "shadow-worker",
  },
}));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.poolQuery, connect: mocks.connect },
  transaction: mocks.transaction,
}));
vi.mock("../src/providers.js", () => ({
  isProviderAuthorizationFailure: vi.fn(() => false),
  prepareProviderSession: vi.fn(),
  reconcileProviderMessage: vi.fn(),
  sendProviderMessage: mocks.sendProviderMessage,
}));
vi.mock("../src/repository.js", () => ({ providerSession: vi.fn() }));

import { sendThreadReply } from "../src/delivery.js";

describe("manual delivery shadow gate", () => {
  beforeEach(() => {
    [mocks.poolQuery, mocks.connect, mocks.transaction, mocks.sendProviderMessage]
      .forEach((mock) => mock.mockReset());
  });

  it("rejects before reserving a job, ledger row, or provider call", async () => {
    await expect(sendThreadReply({
      threadId: "00000000-0000-4000-8000-000000000001",
      actorId: "00000000-0000-4000-8000-000000000002",
      canHandleAny: true,
      body: "Olá",
      idempotencyKey: "shadow-reply",
    })).rejects.toMatchObject({ status: 503, code: "outbound_shadow_mode" });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.sendProviderMessage).not.toHaveBeenCalled();
  });
});
