import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { createMailbox } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("mailbox creation", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("returns an actionable conflict when a stale list leads to duplicate email creation", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "outreach_mailboxes_email_key",
    }));

    await expect(createMailbox(admin, {
      provider: "google",
      email: "Existing@Nikufra.ai",
    })).rejects.toMatchObject({
      status: 409,
      code: "mailbox_exists",
    });

    expect(mocks.query.mock.calls[0]?.[1]?.[0]).toBe("existing@nikufra.ai");
  });
});
