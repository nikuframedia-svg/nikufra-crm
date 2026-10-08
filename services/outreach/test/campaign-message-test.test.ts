import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn(), readiness: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: { outboundEnvEnabled: true, shadowMode: false } }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));
vi.mock("../src/repository.js", () => ({
  audit: mocks.audit,
  campaignReadiness: mocks.readiness,
  assertMailboxReconciliationClear: vi.fn(),
  providerSession: vi.fn(),
}));

import { queueCampaignMessageTest } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const sourceCampaignId = id("100");
const stepId = id("101");
const variantId = id("102");
const contactId = id("103");
const companyId = id("104");
const mailboxId = id("105");
const testCampaignId = id("106");
const audienceId = id("107");
const admin: Actor = { id: id("1"), email: "admin@nikufra.ai", name: "Admin", crmRole: "admin", outreachRole: "viewer", capabilities: new Set() };
const request = { stepId, variantId, contactId, mailboxId };
const requestHash = createHash("sha256").update(JSON.stringify({ actorId: admin.id, sourceCampaignId, ...request })).digest("hex");

describe("single-message test campaign", () => {
  beforeEach(() => {
    mocks.query.mockReset(); mocks.audit.mockReset(); mocks.readiness.mockReset();
    mocks.readiness.mockResolvedValue({ ready: true });
  });

  it("queues one ordinary guarded job without changing the source campaign", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [{
        id: contactId, email: "lead@example.com", optout: false,
        outreach_legal_basis: "contract", outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
        outreach_legal_basis_recorded_by: admin.id, outreach_legal_basis_evidence: "contract-123",
        empresa_id: companyId, contact_name: "Lead", company_name: "Example", cargo: null, telefone: null,
        linkedin_url: null, vertical: "industrial", pais: "PT", cidade: null, website: null,
        verification_status: "valid", suppressed: false,
      }] };
      if (sql.includes("where test_idempotency_key=$1")) return { rows: [] };
      if (sql.includes("from public.outreach_recipients r") && sql.includes("r.campaign_id=$1 and r.contact_id=$2")) return { rows: [{ id: id("111") }] };
      if (sql.includes("from public.outreach_campaigns c") && sql.includes("join public.outreach_campaign_steps")) return { rows: [{ name: "Source", send_days: [1, 2, 3, 4, 5], send_window_start: "09:00", send_window_end: "17:00", timezone: "Europe/Lisbon", subject: "Olá {{nome}}", body: "Mensagem" }] };
      if (sql.includes("from public.outreach_system_state")) return { rows: [{ send_enabled: true, mode: "canary" }] };
      if (sql.includes("insert into public.outreach_campaigns")) return { rows: [{ id: testCampaignId }] };
      if (sql.includes("insert into public.outreach_campaign_steps")) return { rows: [{ id: id("108") }] };
      if (sql.includes("select id from public.outreach_mailboxes")) return { rows: [{ id: mailboxId }] };
      if (sql.includes("insert into public.outreach_audiences")) return { rows: [{ id: audienceId }] };
      if (sql.includes("select id from public.outreach_campaigns where id=$1 and status")) return { rows: [{ id: testCampaignId }] };
      if (sql.includes("select id from public.outreach_audience_members")) return { rows: [{ id: id("109") }] };
      if (sql.includes("select id from public.outreach_recipients")) return { rows: [{ id: id("110") }] };
      if (sql.includes("private.outreach_recipient_eligibility")) return { rows: [{ decision: { eligible: true, reasons: [] } }] };
      if (sql.includes("count(*)::text count from public.outreach_jobs")) return { rows: [{ count: "1" }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(queueCampaignMessageTest(admin, sourceCampaignId, request, "test-key-123")).resolves.toEqual({
      id: testCampaignId, sourceCampaignId, queued: true, duplicate: false,
    });
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("insert into public.outreach_jobs"))).toBe(true);
    expect(statements.some((sql) => sql.includes("update public.outreach_campaigns set status='running'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("update public.outreach_campaigns set") && sql.includes("where id=$1") && !sql.includes("status='running'"))).toBe(false);
    expect(mocks.audit).toHaveBeenCalledWith(admin.id, "campaign.message_test_queued", "campaign", sourceCampaignId, expect.objectContaining({ testCampaignId, contactId, mailboxId }), expect.anything());
  });

  it("returns the original test campaign on an idempotent retry", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [{
        id: contactId, email: "lead@example.com", optout: false,
        outreach_legal_basis: "contract", outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
        outreach_legal_basis_recorded_by: admin.id, outreach_legal_basis_evidence: "contract-123",
        empresa_id: companyId, contact_name: "Lead", company_name: "Example", cargo: null, telefone: null,
        linkedin_url: null, vertical: "industrial", pais: "PT", cidade: null, website: null,
        verification_status: "valid", suppressed: false,
      }] };
      if (sql.includes("where test_idempotency_key=$1")) return { rows: [{ id: testCampaignId, test_request_hash: requestHash }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(queueCampaignMessageTest(admin, sourceCampaignId, request, "test-key-123")).resolves.toMatchObject({ id: testCampaignId, duplicate: true });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_campaigns"))).toBe(false);
  });

  it("rejects a contact outside the source campaign before preparing a send", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("where test_idempotency_key=$1")) return { rows: [] };
      if (sql.includes("from public.outreach_recipients r") && sql.includes("r.campaign_id=$1 and r.contact_id=$2")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(queueCampaignMessageTest(admin, sourceCampaignId, request, "test-key-123")).rejects.toMatchObject({ status: 409, code: "test_contact_not_in_campaign" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_campaigns"))).toBe(false);
  });
});
