import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { archiveCampaign } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const actor: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};
const campaignId = "00000000-0000-4000-8000-000000000100";

describe("apagar campanha", () => {
  beforeEach(() => mocks.query.mockReset());

  it("arquiva um rascunho e cancela apenas os jobs pendentes", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("for update")) return { rows: [{ name: "Piloto", status: "draft" }] };
      if (sql.includes("count(*)::text count")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    });
    await expect(archiveCampaign(actor, campaignId)).resolves.toEqual({ id: campaignId, status: "archived" });
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("status='cancelled'") && sql.includes("status='pending'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("status='archived'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("campaign.archived"))).toBe(true);
    expect(statements.some((sql) => sql.includes("delete from public.outreach"))).toBe(false);
  });

  it("recusa uma campanha ativa sem alterar os jobs", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ name: "Ativa", status: "running" }] });
    await expect(archiveCampaign(actor, campaignId)).rejects.toMatchObject({ status: 409, code: "campaign_running" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("recusa jobs em curso ou por reconciliar", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ name: "Pausada", status: "paused" }] });
    mocks.query.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    await expect(archiveCampaign(actor, campaignId)).rejects.toMatchObject({ status: 409, code: "campaign_jobs_unsettled" });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
