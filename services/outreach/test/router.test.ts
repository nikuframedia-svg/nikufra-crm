import { describe, expect, it } from "vitest";
import { Router } from "../src/router.js";
import { buildRouter } from "../src/api-routes.js";

describe("versioned router", () => {
  it("matches deep links and decodes parameters", () => {
    const router = new Router();
    router.add("GET", "/api/outreach/v1/campaigns/:campaignId", async () => undefined);
    expect(router.match("GET", "/api/outreach/v1/campaigns/a%20b")?.params).toEqual({ campaignId: "a b" });
    expect(router.match("GET", "/api/outreach/v1/campaigns/secret")?.route.path).toBe("/api/outreach/v1/campaigns/:campaignId");
    expect(router.match("POST", "/api/outreach/v1/campaigns/a")).toBeNull();
  });

  it("exposes the versioned health alias with the same public handler", () => {
    const router = buildRouter();
    const loopback = router.match("GET", "/healthz");
    const proxyAlias = router.match("GET", "/api/outreach/v1/healthz");
    expect(loopback?.route.public).toBe(true);
    expect(proxyAlias?.route.public).toBe(true);
    expect(proxyAlias?.route.handler).toBe(loopback?.route.handler);
  });
});

describe("verification evidence API", () => {
  it("requires launch permission for a real message test", () => {
    const route = buildRouter().match("POST", "/api/outreach/v1/campaigns/00000000-0000-4000-8000-000000000010/message-tests");
    expect(route?.route.capability).toBe("outreach.campaign.launch");
    expect(route?.route.public).toBe(false);
  });
  it("exposes the attestation workflow only through the admin capability", () => {
    const match = buildRouter().match("POST", "/api/outreach/v1/verifications/evidence");
    expect(match?.route.capability).toBe("outreach.admin");
    expect(match?.route.public).toBe(false);
  });

  it("keeps delivery adjudication behind the admin capability", () => {
    const match = buildRouter().match("POST", "/api/outreach/v1/jobs/00000000-0000-4000-8000-000000000010/adjudicate");
    expect(match?.route.capability).toBe("outreach.admin");
    expect(match?.route.public).toBe(false);
    const list = buildRouter().match("GET", "/api/outreach/v1/job-reconciliation");
    expect(list?.route.capability).toBe("outreach.admin");
    expect(list?.route.public).toBe(false);
  });
});
