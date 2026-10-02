import { describe, expect, it } from "vitest";
import { assessDkim, assessDmarc, assessMx, assessSpf } from "../src/dns.js";

describe("DMARC readiness", () => {
  it("accepts a single monitoring policy while reporting that it is not enforced", () => {
    expect(assessDmarc(["v=DMARC1; p=none"])).toMatchObject({
      status: "pass", policy: "none", validForSending: true, enforced: false,
    });
  });

  it("rejects missing, duplicated, and invalid policies", () => {
    expect(assessDmarc([]).status).toBe("missing");
    expect(assessDmarc(["v=DMARC1; p=none", "v=DMARC1; p=reject"]).status).toBe("warning");
    expect(assessDmarc(["v=DMARC1; p=invalid"]).status).toBe("warning");
  });
});

describe("DKIM readiness", () => {
  it("rejects obsolete keys shorter than 1024 bits", () => {
    const shortKey = Buffer.alloc(64, 7).toString("base64");
    expect(assessDkim([`v=DKIM1; k=rsa; p=${shortKey}`], "google").status).toBe("warning");
  });

  it("accepts one syntactically valid key with at least 1024 bits", () => {
    const key = Buffer.alloc(128, 7).toString("base64");
    expect(assessDkim([`v=DKIM1; k=rsa; p=${key}`], "google").status).toBe("pass");
  });
});

describe("Google SPF readiness", () => {
  it("accepts the Google sender authorization", () => {
    expect(assessSpf(["v=spf1 include:_spf.google.com ~all"]).status).toBe("pass");
  });

  it("does not treat an Outlook-only or generic mx record as Gmail authorization", () => {
    expect(assessSpf(["v=spf1 include:spf.protection.outlook.com -all"]).status).toBe("warning");
    expect(assessSpf(["v=spf1 a mx -all"]).status).toBe("warning");
  });
});

describe("Google MX readiness", () => {
  it("accepts current and legacy Google Workspace MX targets", () => {
    expect(assessMx([{ exchange: "smtp.google.com.", priority: 1 }]).status).toBe("pass");
    expect(assessMx([{ exchange: "ASPMX.L.GOOGLE.COM", priority: 1 }]).status).toBe("pass");
  });

  it("does not certify unrelated or null MX for a Google mailbox", () => {
    expect(assessMx([{ exchange: "mail.example.net", priority: 10 }]).status).toBe("warning");
    expect(assessMx([{ exchange: ".", priority: 0 }]).status).toBe("missing");
    expect(assessMx([]).status).toBe("missing");
  });
});
