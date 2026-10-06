import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { campaignAction, createCampaign, updateCampaign } from "../src/mutations.js";
import { campaignReadiness, getCampaign } from "../src/repository.js";
import type { Actor } from "../src/types.js";

const campaignId = "00000000-0000-4000-8000-000000000100";
const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

function readinessRow(activeStepVariantCount: number, eligibleRecipientCount: number, selectedMailboxCount: number, readyMailboxCount: number) {
  return { activeStepVariantCount, eligibleRecipientCount, selectedMailboxCount, readyMailboxCount };
}

describe("campaign readiness authority", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("reports every launch blocker and requires the latest DNS check to be green and younger than 24 hours", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [readinessRow(0, 0, 0, 0)] });

    await expect(campaignReadiness(campaignId)).resolves.toEqual({
      ready: false,
      activeStepVariantCount: 0,
      eligibleRecipientCount: 0,
      selectedMailboxCount: 0,
      readyMailboxCount: 0,
      blockers: [
        "Adiciona pelo menos um passo de email ativo com uma variante ativa.",
        "Adiciona pelo menos um destinatário elegível.",
        "Seleciona pelo menos uma mailbox para a campanha.",
      ],
    });

    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("step.ativo and step.kind='email'");
    expect(sql).toContain("variant.step_id=step.id and variant.ativo");
    expect(sql).toContain("recipient.status='eligible'");
    expect(sql).toContain("from public.outreach_campaign_mailboxes selection");
    expect(sql).toContain("join public.outreach_mailboxes mailbox on mailbox.id=selection.mailbox_id");
    expect(sql).toContain("mailbox.provider='google'");
    expect(sql).toContain("mailbox.status='active'");
    expect(sql).toContain("mailbox.send_enabled");
    expect(sql).toContain("dns.spf_status='pass'");
    expect(sql).toContain("dns.dkim_status='pass'");
    expect(sql).toContain("dns.dmarc_status='pass'");
    expect(sql).toContain("dns.mx_status='pass'");
    expect(sql).toContain("dns.checked_at > now()-interval '24 hours'");
    expect(sql).toContain("order by dns.checked_at desc,dns.id desc");
  });

  it("creates a campaign with its selected audience and materialized recipient atomically", async () => {
    const audienceId = "00000000-0000-4000-8000-000000000300";
    const contactId = "00000000-0000-4000-8000-000000000301";
    const companyId = "00000000-0000-4000-8000-000000000302";
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("insert into public.outreach_campaigns")) return { rows: [{ id: campaignId }] };
      if (sql.includes("insert into public.outreach_campaign_steps")) return { rows: [{ id: "step-1" }] };
      if (sql.includes("select contact_id from public.outreach_audience_members")) return { rows: [{ contact_id: contactId }] };
      if (sql.includes("from public.contactos c join public.empresas")) return { rows: [{
        id: contactId, email: "lead@example.com", optout: false,
        outreach_legal_basis: "contract", outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
        outreach_legal_basis_recorded_by: admin.id, outreach_legal_basis_evidence: "contract-123",
        empresa_id: companyId, contact_name: "Lead", company_name: "Example", cargo: null, telefone: null,
        linkedin_url: null, vertical: "industrial", pais: "PT", cidade: null, website: null,
        verification_status: "valid", suppressed: false,
      }] };
      if (sql.includes("select id from public.outreach_campaigns where id=$1 and status")) return { rows: [{ id: campaignId }] };
      if (sql.includes("select id from public.outreach_audience_members")) return { rows: [{ id: "member-1" }] };
      return { rows: [], rowCount: 1 };
    });
    await expect(createCampaign(admin, { name: "Pilot", audienceId, steps: [{ variants: [{ subject: "Olá", body: "Mensagem" }] }] })).resolves.toMatchObject({ id: campaignId });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_campaign_audiences"))).toBe(true);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into public.outreach_recipients"))).toBe(true);
    expect(mocks.query.mock.calls.some(([sql, params]) => String(sql).includes("campaign.created") && String(params?.[2]).includes(audienceId))).toBe(true);
  });

  it("makes campaign detail return backend blockers even when total recipients and inactive steps exist", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.outreach_campaigns c where c.id=$1")) {
        return { rows: [{ id: campaignId, name: "Draft", status: "draft", recipientCount: 12 }] };
      }
      if (sql.includes("from public.outreach_campaign_steps s left join")) {
        return { rows: [{ id: "step-inactive", position: 1, kind: "email", active: false, variants: [] }] };
      }
      if (sql.includes("group by status order by status")) {
        return { rows: [{ status: "ineligible", count: 12 }] };
      }
      if (sql.includes('as "readyMailboxCount"')) {
        return { rows: [readinessRow(0, 0, 0, 0)] };
      }
      if (sql.includes("from public.outreach_mailboxes mailbox")) {
        return { rows: [] };
      }
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const detail = await getCampaign(campaignId);

    expect(detail).toMatchObject({
      id: campaignId,
      recipientCount: 12,
      readiness: { ready: false, activeStepVariantCount: 0, eligibleRecipientCount: 0, selectedMailboxCount: 0, readyMailboxCount: 0 },
    });
    expect(detail.blockers).toHaveLength(3);
    expect(detail.blockers[1]).toMatch(/destinatário elegível/);
    expect(detail.blockers[2]).toMatch(/Seleciona pelo menos uma mailbox/);
  });

  it("rejects launch with the same authoritative readiness result when DNS is stale", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("select status::text status")) return { rows: [{ status: "draft" }] };
      if (sql.includes('as "readyMailboxCount"')) return { rows: [readinessRow(1, 8, 1, 0)] };
      throw new Error(`SQL inesperado: ${sql}`);
    });

    await expect(campaignAction(admin, campaignId, "launch")).rejects.toMatchObject({
      status: 409,
      code: "campaign_not_ready",
      details: {
        ready: false,
        activeStepVariantCount: 1,
        eligibleRecipientCount: 8,
        selectedMailboxCount: 1,
        readyMailboxCount: 0,
      },
    });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("set status='running'"))).toBe(false);
  });

  it("uses the same 24-hour DNS freshness rule while materializing launch jobs", async () => {
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("select status::text status")) return { rows: [{ status: "draft" }] };
      if (sql.includes('as "readyMailboxCount"')) return { rows: [readinessRow(1, 8, 1, 1)] };
      if (sql.includes("select count(*)::text count from public.outreach_jobs")) return { rows: [{ count: "8" }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(campaignAction(admin, campaignId, "launch")).resolves.toEqual({
      id: campaignId,
      status: "running",
    });

    const jobInsert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("insert into public.outreach_jobs"));
    expect(String(jobInsert?.[0])).toContain("from public.outreach_campaign_mailboxes selection");
    expect(String(jobInsert?.[0])).toContain("selection.campaign_id=$1");
    expect(String(jobInsert?.[0])).toContain("dns.checked_at > now()-interval '24 hours'");
    expect(String(jobInsert?.[0])).toContain("order by dns.checked_at desc,dns.id desc limit 1");
  });

  it("replaces campaign mailbox selection atomically and writes a dedicated audit entry", async () => {
    const mailboxId = "00000000-0000-4000-8000-000000000200";
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.outreach_campaigns") && sql.includes("for update")) return { rows: [{ status: "draft" }] };
      if (sql.includes("select id from public.outreach_mailboxes")) return { rows: [{ id: mailboxId }] };
      if (sql.includes("select mailbox_id from public.outreach_campaign_mailboxes")) return { rows: [{ mailbox_id: mailboxId }] };
      return { rows: [], rowCount: 1 };
    });

    await expect(updateCampaign(admin, campaignId, { mailboxIds: [mailboxId] })).resolves.toEqual({
      id: campaignId,
      audienceAdded: null,
      mailboxIds: [mailboxId],
    });

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("update public.outreach_campaigns set"))).toBe(false);
    expect(statements.some((sql) => sql.includes("delete from public.outreach_campaign_mailboxes"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_campaign_mailboxes"))).toBe(true);
    const mailboxAudit = mocks.query.mock.calls.find(([sql]) => String(sql).includes("campaign.mailboxes_updated"));
    expect(mailboxAudit?.[1]?.[2]).toContain(mailboxId);
  });

  it("locks mailbox selection after launch so paused jobs cannot retain a removed sender", async () => {
    const mailboxId = "00000000-0000-4000-8000-000000000200";
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "paused" }] });

    await expect(updateCampaign(admin, campaignId, { mailboxIds: [mailboxId] })).rejects.toMatchObject({
      status: 409,
      code: "campaign_mailboxes_locked",
    });

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("for update");
    expect(statements.some((sql) => sql.includes("delete from public.outreach_campaign_mailboxes"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_campaign_mailboxes"))).toBe(false);
  });

  it("replaces draft sequence and variants together while retaining campaign settings", async () => {
    let stepNumber = 0;
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("from public.outreach_campaigns") && sql.includes("for update")) return { rows: [{ status: "draft" }] };
      if (sql.includes("count(*)::text count from public.outreach_jobs")) return { rows: [{ count: "0" }] };
      if (sql.includes("insert into public.outreach_campaign_steps")) return { rows: [{ id: `step-${++stepNumber}` }] };
      if (sql.includes("select mailbox_id from public.outreach_campaign_mailboxes")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    await updateCampaign(admin, campaignId, { steps: [
      { kind: "email", delayMinutes: 0, replyToPrevious: false, variants: [{ name: "A", weight: 100, subject: "Primeiro", body: "Olá" }] },
      { kind: "email", delayMinutes: 2_880, replyToPrevious: true, variants: [{ name: "A", weight: 100, subject: "Segundo", body: "Seguimento" }] },
    ] });

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("update public.outreach_campaigns set"))).toBe(false);
    expect(statements.some((sql) => sql.includes("delete from public.outreach_campaign_steps"))).toBe(true);
    expect(statements.filter((sql) => sql.includes("insert into public.outreach_campaign_steps"))).toHaveLength(2);
    expect(statements.filter((sql) => sql.includes("insert into public.outreach_campaign_variants"))).toHaveLength(2);
    expect(statements.some((sql) => sql.includes("campaign.steps_updated"))).toBe(true);
  });

  it("refuses sequence replacement after the first launch", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "paused" }] });
    await expect(updateCampaign(admin, campaignId, { steps: [
      { kind: "email", variants: [{ subject: "Assunto", body: "Corpo" }] },
    ] })).rejects.toMatchObject({ status: 409, code: "campaign_steps_locked" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("delete from public.outreach_campaign_steps"))).toBe(false);
  });

  it("does not reset campaign configuration when only adding an audience", async () => {
    const audienceId = "00000000-0000-4000-8000-000000000300";
    const contactId = "00000000-0000-4000-8000-000000000301";
    const companyId = "00000000-0000-4000-8000-000000000302";
    mocks.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("select contact_id from public.outreach_audience_members")) {
        return { rows: [{ contact_id: contactId }], rowCount: 1 };
      }
      if (sql.includes("from public.outreach_campaigns") && sql.includes("for update") && sql.includes("status::text status")) return { rows: [{ status: "draft" }] };
      if (sql.includes("from public.contactos c join public.empresas")) {
        return {
          rows: [{
            id: contactId,
            email: "ready@example.com",
            optout: false,
            outreach_legal_basis: "contract",
            outreach_consent_at: null,
            outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
            outreach_legal_basis_recorded_by: admin.id,
            outreach_legal_basis_evidence: "Existing contract",
            empresa_id: companyId,
            contact_name: "Ready Contact",
            company_name: "Ready Company",
            cargo: null,
            telefone: null,
            linkedin_url: null,
            vertical: "outro",
            pais: "PT",
            cidade: null,
            website: null,
            verification_status: "valid",
            suppressed: false,
          }],
        };
      }
      if (sql.includes("from public.outreach_campaigns where id=$1 and status")) return { rows: [{ id: campaignId }] };
      if (sql.includes("from public.outreach_campaign_variants")) return { rows: [] };
      if (sql.includes("select id from public.outreach_audience_members")) return { rows: [{ id: "member-1" }] };
      if (sql.includes("select mailbox_id from public.outreach_campaign_mailboxes")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    await expect(updateCampaign(admin, campaignId, { addAudienceId: audienceId })).resolves.toMatchObject({
      id: campaignId,
      audienceAdded: audienceId,
      mailboxIds: [],
    });

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("update public.outreach_campaigns set"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_recipients"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into public.outreach_campaign_audiences"))).toBe(true);
  });
});
