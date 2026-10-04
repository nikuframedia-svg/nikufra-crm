import { describe, expect, it } from "vitest";
import { instantlyVerificationSettings, mapInstantlyResult, verifyLeadsWithInstantly } from "../src/instantly-verification.js";
import { buildRouter } from "../src/api-routes.js";
import type { Actor } from "../src/types.js";

describe("Instantly mailbox verification", () => {
  const email = "lead@example.com";

  it("only treats a verified non-catch-all mailbox as valid", () => {
    expect(mapInstantlyResult({ email, verification_status: "verified", catch_all: false }).status).toBe("valid");
    expect(mapInstantlyResult({ email, verification_status: "verified", catch_all: true }).status).toBe("catch_all");
    expect(mapInstantlyResult({ email, verification_status: "verified", catch_all: "pending" }).status).toBe("pending");
    expect(mapInstantlyResult({ email, verification_status: "verified" }).status).toBe("pending");
    expect(mapInstantlyResult({ email, verification_status: "invalid", catch_all: false }).status).toBe("invalid");
  });

  it("requires campaign management permission to start paid verification", () => {
    const router = buildRouter();
    const verify = router.match("POST", "/api/outreach/v1/verifications/provider");
    const settings = router.match("GET", "/api/outreach/v1/verifications/provider");
    expect(verify?.route.capability).toBe("outreach.campaign.manage");
    expect(verify?.route.public).toBe(false);
    expect(settings?.route.capability).toBe("outreach.campaign.manage");
  });

  it("fails closed without a server-side provider key", async () => {
    const actor: Actor = { id: "00000000-0000-4000-8000-000000000001", email: "admin@nikufra.ai", name: "Admin", crmRole: "admin", outreachRole: "campaign_manager", capabilities: new Set(["outreach.campaign.manage"]) };
    expect(instantlyVerificationSettings().configured).toBe(false);
    await expect(verifyLeadsWithInstantly(actor, {
      contactIds: ["00000000-0000-4000-8000-000000000002"],
      acknowledgeProviderTransfer: true,
    })).rejects.toMatchObject({ status: 503, code: "verification_provider_not_configured" });
  });
});
