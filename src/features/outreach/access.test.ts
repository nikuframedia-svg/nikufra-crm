import { describe, expect, it } from "vitest";
import { canAccessOutreachPath, canSeeOutreachNavigation } from "./access";

describe("Outreach dark-deploy navigation gate", () => {
  it("shows the module only to CRM administrators by default", () => {
    expect(canSeeOutreachNavigation(true, "admin")).toBe(true);
    expect(canSeeOutreachNavigation(true, "member")).toBe(false);
    expect(canSeeOutreachNavigation(true, undefined)).toBe(false);
  });

  it("allows the wider rollout only after the flag is disabled", () => {
    expect(canSeeOutreachNavigation(false, "member")).toBe(true);
  });
});

describe("Outreach role visibility", () => {
  it("keeps a viewer on campaign and metric routes only", () => {
    const capabilities = ["outreach.read"];
    expect(canAccessOutreachPath("/outreach", capabilities)).toBe(true);
    expect(canAccessOutreachPath("/outreach/campanhas/campaign-1", capabilities)).toBe(true);
    expect(canAccessOutreachPath("/outreach/deliverability", capabilities)).toBe(true);
    expect(canAccessOutreachPath("/outreach/respostas", capabilities)).toBe(false);
    expect(canAccessOutreachPath("/outreach/audiencias", capabilities)).toBe(false);
    expect(canAccessOutreachPath("/outreach/mailboxes", capabilities)).toBe(false);
    expect(canAccessOutreachPath("/outreach/definicoes", capabilities)).toBe(false);
  });

  it("lets a sales rep handle replies without exposing campaign administration", () => {
    const capabilities = ["outreach.read", "outreach.thread.handle"];
    expect(canAccessOutreachPath("/outreach/respostas", capabilities)).toBe(true);
    expect(canAccessOutreachPath("/outreach/audiencias", capabilities)).toBe(false);
    expect(canAccessOutreachPath("/outreach/mailboxes", capabilities)).toBe(false);
  });
});
