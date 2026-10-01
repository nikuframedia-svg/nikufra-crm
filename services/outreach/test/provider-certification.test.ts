import { afterEach, describe, expect, it, vi } from "vitest";

describe("initial provider certification gates", () => {
  afterEach(() => {
    delete process.env.OUTREACH_ENABLE_MICROSOFT;
    delete process.env.OUTREACH_ENABLE_SMTP;
    vi.resetModules();
  });

  it("does not expose Microsoft or SMTP solely because a deploy flag was set", async () => {
    process.env.OUTREACH_ENABLE_MICROSOFT = "true";
    process.env.OUTREACH_ENABLE_SMTP = "true";
    vi.resetModules();

    const { config } = await import("../src/config.js");

    expect(config.microsoft.requested).toBe(true);
    expect(config.microsoft.enabled).toBe(false);
    expect(config.smtpRequested).toBe(true);
    expect(config.smtpEnabled).toBe(false);
  });
});
