import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query }, transaction: vi.fn() }));

import { contactEligibility } from "../src/mutations.js";

describe("audience eligibility pre-analysis", () => {
  beforeEach(() => mocks.query.mockReset());

  it("uses the keyed suppression authority so HMAC-only RGPD blocks remain effective", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      id: "00000000-0000-4000-8000-000000000001",
      email: "restored@example.com",
      optout: false,
      outreach_legal_basis: "legitimate_interest",
      outreach_consent_at: null,
      outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
      outreach_legal_basis_recorded_by: "00000000-0000-4000-8000-000000000009",
      outreach_legitimate_interest_purpose: "Commercial relationship",
      outreach_lia_reference: "LIA-2026-01",
      outreach_legitimate_interest_expires_at: new Date("2099-01-01T00:00:00Z"),
      empresa_id: "00000000-0000-4000-8000-000000000002",
      contact_name: "Restored Lead",
      company_name: "Example",
      cargo: null,
      telefone: null,
      linkedin_url: null,
      vertical: "industrial",
      pais: "PT",
      cidade: null,
      website: null,
      verification_status: "valid",
      suppressed: true,
    }] });

    const items = await contactEligibility(["00000000-0000-4000-8000-000000000001"]);

    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("private.outreach_is_suppressed");
    expect(items[0]).toMatchObject({ eligible: false, reasons: ["suppressed"] });
  });

  it("blocks an unknown address when its DNS check did not prove a mail route", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      id: "00000000-0000-4000-8000-000000000001",
      email: "does-not-exist@example.com",
      optout: false,
      outreach_legal_basis: "legitimate_interest",
      outreach_consent_at: null,
      outreach_legal_basis_recorded_at: new Date("2026-10-01T00:00:00Z"),
      outreach_legal_basis_recorded_by: "00000000-0000-4000-8000-000000000009",
      outreach_legitimate_interest_purpose: "Commercial relationship",
      outreach_lia_reference: "LIA-2026-01",
      outreach_legitimate_interest_expires_at: new Date("2099-01-01T00:00:00Z"),
      empresa_id: "00000000-0000-4000-8000-000000000002",
      contact_name: "Invented Lead",
      company_name: "Example",
      cargo: null,
      telefone: null,
      linkedin_url: null,
      vertical: "industrial",
      pais: "PT",
      cidade: null,
      website: null,
      verification_status: "unknown",
      suppressed: false,
    }] });

    const [item] = await contactEligibility(["00000000-0000-4000-8000-000000000001"]);
    expect(item).toMatchObject({ eligible: false, reasons: ["verification_unknown"] });
  });

  it("allows a consented contact with a recent inconclusive MX check", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      id: "00000000-0000-4000-8000-000000000001", email: "lead@example.com", optout: false,
      outreach_legal_basis: "consent", outreach_consent_at: new Date("2026-10-01T00:00:00Z"),
      outreach_consent_source: "Formulário de contacto",
      outreach_legal_basis_recorded_at: new Date("2026-10-20T00:00:00Z"),
      outreach_legal_basis_recorded_by: "00000000-0000-4000-8000-000000000009",
      empresa_id: "00000000-0000-4000-8000-000000000002", contact_name: "Lead",
      company_name: "Example", cargo: null, telefone: null, linkedin_url: null,
      vertical: "industrial", pais: "PT", cidade: null, website: null,
      verification_status: "unknown", verification_provider: "dns_syntax",
      verification_reasons: ["Domínio com MX válido, mas a existência desta caixa não foi confirmada."],
      owned_mailbox_history: false, suppressed: false,
    }] });
    const [item] = await contactEligibility(["00000000-0000-4000-8000-000000000001"]);
    expect(item).toMatchObject({ eligible: true, reasons: [], verification: "unknown" });
  });

  it("shows missing lawful-basis evidence before a contact can be selected", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      id: "00000000-0000-4000-8000-000000000001", email: "lead@example.com", optout: false,
      outreach_legal_basis: "legitimate_interest", outreach_legal_basis_recorded_at: null,
      outreach_legal_basis_recorded_by: null, outreach_lia_reference: null,
      outreach_legitimate_interest_purpose: null, outreach_legitimate_interest_expires_at: null,
      empresa_id: "00000000-0000-4000-8000-000000000002", contact_name: "Lead",
      company_name: "Example", cargo: null, telefone: null, linkedin_url: null,
      vertical: "industrial", pais: "PT", cidade: null, website: null,
      verification_status: "valid", suppressed: false,
    }] });
    const [item] = await contactEligibility(["00000000-0000-4000-8000-000000000001"]);
    expect(item).toMatchObject({ eligible: false, reasons: ["lawful_basis_missing"] });
  });
});
