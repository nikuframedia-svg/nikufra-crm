import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));
vi.mock("../src/repository.js", () => ({ audit: mocks.audit }));

import { addCampaignCsvContacts } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const actor: Actor = { id: id("1"), email: "admin@nikufra.ai", name: "Admin", crmRole: "admin", outreachRole: "viewer", capabilities: new Set() };
const campaignId = id("100");
const audienceId = id("101");
const contactIds = [id("201"), id("202")];

function contact(idValue: string, email: string) {
  return { id: idValue, email, optout: false, outreach_legal_basis: null, outreach_legal_basis_recorded_at: null,
    outreach_legal_basis_recorded_by: null, empresa_id: id("300"), contact_name: "Pessoa", company_name: "Empresa",
    cargo: null, telefone: null, linkedin_url: null, vertical: "outro", pais: "PT", cidade: null, website: null,
    verification_status: "unknown", owned_mailbox_history: false, suppressed: false };
}

describe("CSV imported into a campaign", () => {
  beforeEach(() => { mocks.query.mockReset(); mocks.audit.mockReset(); });

  it("keeps CRM duplicates and existing campaign recipients while adding every unique email", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [contact(contactIds[0]!, "one@example.com"), contact(contactIds[1]!, "two@example.com")] };
      if (sql.includes("select status::text from public.outreach_campaigns")) return { rows: [{ status: "draft" }] };
      if (sql.includes("insert into public.outreach_audiences")) return { rows: [{ id: audienceId }] };
      if (sql.includes("insert into public.outreach_recipients")) return { rows: [{ contact_id: contactIds[1] }] };
      return { rows: [], rowCount: 1 };
    });
    await expect(addCampaignCsvContacts(actor, campaignId, { name: "Piloto · lista.csv", contactIds })).resolves.toMatchObject({
      audienceId, assessed: 2, added: 1, existing: 1, eligible: 0,
    });
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("insert into public.outreach_audience_members"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_campaign_audiences"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_recipients") && sql.includes("do nothing"))).toBe(true);
    expect(statements.some((sql) => sql.includes("update public.contactos"))).toBe(false);
    expect(mocks.audit).toHaveBeenCalledWith(actor.id, "campaign.csv_contacts_added", "campaign", campaignId, expect.objectContaining({ added: 1, existing: 1 }), expect.anything());
  });

  it("schedules only the newly added eligible contacts when the campaign is running", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [{ ...contact(contactIds[0]!, "one@example.com"), outreach_legal_basis: "contract", outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"), outreach_legal_basis_recorded_by: actor.id, outreach_legal_basis_evidence: "contract-1", verification_status: "valid" }] };
      if (sql.includes("select status::text from public.outreach_campaigns")) return { rows: [{ status: "running" }] };
      if (sql.includes("insert into public.outreach_audiences")) return { rows: [{ id: audienceId }] };
      if (sql.includes("insert into public.outreach_recipients")) return { rows: [{ contact_id: contactIds[0] }] };
      if (sql.includes("count(*)::text count from public.outreach_jobs")) return { rows: [{ count: "1" }] };
      return { rows: [], rowCount: 1 };
    });
    await expect(addCampaignCsvContacts(actor, campaignId, { name: "Novos contactos", contactIds: [contactIds[0]] }))
      .resolves.toMatchObject({ added: 1, eligible: 1 });
    const jobInsert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("insert into public.outreach_jobs"));
    expect(jobInsert?.[1]).toEqual([campaignId, [contactIds[0]]]);
  });

  it("reuses the same CSV list on retry without duplicating recipients", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [contact(contactIds[0]!, "one@example.com")] };
      if (sql.includes("select status::text from public.outreach_campaigns")) return { rows: [{ status: "draft" }] };
      if (sql.includes("from public.outreach_audiences audience")) return { rows: [{ id: audienceId }] };
      return { rows: [], rowCount: 1 };
    });
    await expect(addCampaignCsvContacts(actor, campaignId, { name: "Piloto · lista.csv", contactIds: [contactIds[0]] }))
      .resolves.toMatchObject({ audienceId, added: 0, existing: 1 });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_audiences"))).toBe(false);
  });

  it("does not create a list when the campaign no longer accepts contacts", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [contact(contactIds[0]!, "one@example.com")] };
      if (sql.includes("select status::text from public.outreach_campaigns")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(addCampaignCsvContacts(actor, campaignId, { name: "Lista", contactIds: [contactIds[0]] }))
      .rejects.toMatchObject({ status: 409, code: "campaign_not_editable" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_audiences"))).toBe(false);
  });

  it("rejects duplicate contact IDs before accessing the database", async () => {
    await expect(addCampaignCsvContacts(actor, campaignId, { name: "Lista", contactIds: [contactIds[0], contactIds[0]] })).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
