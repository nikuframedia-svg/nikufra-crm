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

  it("keeps a DNS-only unknown mailbox out of an audience", async () => {
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
