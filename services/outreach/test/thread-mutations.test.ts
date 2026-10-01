import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, OutreachRole } from "../src/types.js";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }),
}));

import { updateThread } from "../src/mutations.js";

const threadId = "00000000-0000-4000-8000-000000000010";

function actor(crmRole: "admin" | "member", outreachRole: OutreachRole): Actor {
  return {
    id: `00000000-0000-4000-8000-0000000000${crmRole === "admin" ? "01" : outreachRole === "campaign_manager" ? "02" : "03"}`,
    email: "user@nikufra.ai",
    name: "User",
    crmRole,
    outreachRole,
    capabilities: new Set(),
  };
}

describe("thread mutation role bindings", () => {
  beforeEach(() => mocks.query.mockReset().mockResolvedValue({ rows: [{ id: threadId }], rowCount: 1 }));

  it("lets an admin classify without an unused owner placeholder", async () => {
    await updateThread(actor("admin", "viewer"), threadId, "classify", { classification: "positive" });
    expect(mocks.query.mock.calls[0]?.[0]).not.toContain("assigned_to");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([threadId, "positive"]);
    expect(mocks.query.mock.calls[1]?.[0]).toContain("outreach_audit_log");
  });

  it("lets a campaign manager archive without extra bind values", async () => {
    await updateThread(actor("member", "campaign_manager"), threadId, "archive", {});
    expect(mocks.query.mock.calls[0]?.[0]).not.toContain("assigned_to");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([threadId]);
  });

  it("scopes a sales representative classification to their assignment", async () => {
    const sales = actor("member", "sales_rep");
    await updateThread(sales, threadId, "classify", { classification: "question" });
    expect(mocks.query.mock.calls[0]?.[0]).toContain("assigned_to=$3");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([threadId, "question", sales.id]);
  });

  it("uses the second placeholder for a sales representative archive", async () => {
    const sales = actor("member", "sales_rep");
    await updateThread(sales, threadId, "archive", {});
    expect(mocks.query.mock.calls[0]?.[0]).toContain("assigned_to=$2");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([threadId, sales.id]);
  });

  it("writes the mutation and its audit through the same transaction client", async () => {
    await updateThread(actor("admin", "viewer"), threadId, "archive", {});
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("update public.outreach_threads");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("insert into public.outreach_audit_log");
  });
});
