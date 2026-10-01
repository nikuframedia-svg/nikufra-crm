import { describe, expect, it } from "vitest";
import { bearerToken, capabilitiesFor } from "../src/auth.js";
import { HttpError } from "../src/errors.js";

describe("Outreach capabilities", () => {
  it("keeps viewers read-only and sales reps scoped to thread handling", () => {
    expect([...capabilitiesFor("member", "viewer")]).toEqual(["outreach.read"]);
    expect(capabilitiesFor("member", "sales_rep").has("outreach.thread.handle")).toBe(true);
    expect(capabilitiesFor("member", "sales_rep").has("outreach.campaign.launch")).toBe(false);
  });

  it("gives CRM administrators every sensitive capability", () => {
    const capabilities = capabilitiesFor("admin", "viewer");
    expect(capabilities.has("outreach.admin")).toBe(true);
    expect(capabilities.has("outreach.mailbox.manage")).toBe(true);
    expect(capabilities.has("outreach.suppression.manage")).toBe(true);
  });

  it("rejects requests without a bearer token with 401", () => {
    expect(() => bearerToken({ headers: {} } as never)).toThrowError(HttpError);
    try { bearerToken({ headers: {} } as never); } catch (error) {
      expect((error as HttpError).status).toBe(401);
    }
  });
});
