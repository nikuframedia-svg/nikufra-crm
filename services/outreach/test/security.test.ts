import { describe, expect, it } from "vitest";
import { publicError, HttpError } from "../src/errors.js";
import { aggregateRateLimitKey, clientAddress, FixedWindowRateLimiter, requestRateLimitKey } from "../src/rate-limit.js";
import { resolveMailEndpoint } from "../src/transport-security.js";
import { z } from "zod";

describe("negative security paths", () => {
  it("returns 429 after the fixed-window budget", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(() => now);
    limiter.assert("ip:route", 2, 100);
    limiter.assert("ip:route", 2, 100);
    expect(() => limiter.assert("ip:route", 2, 100)).toThrowError(HttpError);
    now += 101;
    expect(() => limiter.assert("ip:route", 2, 100)).not.toThrow();
  });

  it("bounds attacker-controlled rate-limit keys", () => {
    const limiter = new FixedWindowRateLimiter(() => 1_000, 3);
    for (let index = 0; index < 20; index += 1) limiter.assert(`attacker-${index}`, 1);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });

  it("uses Caddy's right-most forwarded client only for a trusted private proxy", () => {
    const proxied = {
      headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.42" },
      socket: { remoteAddress: "172.18.0.4" },
    } as never;
    const direct = {
      headers: { "x-forwarded-for": "198.51.100.99" },
      socket: { remoteAddress: "203.0.113.10" },
    } as never;

    expect(clientAddress(proxied)).toBe("198.51.100.42");
    expect(clientAddress(direct)).toBe("203.0.113.10");
  });

  it("isolates public-flow rate limits by a hash without exposing the token", () => {
    const request = { headers: {}, socket: { remoteAddress: "172.18.0.4" } } as never;
    const route = "/api/outreach/v1/unsubscribe/:token";
    const first = requestRateLimitKey(request, route, new URL("https://crm.nikufra.ai/api/outreach/v1/unsubscribe/private-token-a"));
    const second = requestRateLimitKey(request, route, new URL("https://crm.nikufra.ai/api/outreach/v1/unsubscribe/private-token-b"));

    expect(first).not.toBe(second);
    expect(first).not.toContain("private-token-a");
    expect(second).not.toContain("private-token-b");
  });

  it("combines aggregate and per-token unsubscribe budgets", () => {
    const limiter = new FixedWindowRateLimiter(() => 1_000);
    const request = { headers: {}, socket: { remoteAddress: "198.51.100.42" } } as never;
    const route = "/api/outreach/v1/unsubscribe/:token";
    const aggregate = aggregateRateLimitKey(request, route);
    const firstFlow = requestRateLimitKey(request, route, new URL("https://crm.nikufra.ai/api/outreach/v1/unsubscribe/token-a"));

    for (let count = 0; count < 10; count += 1) {
      limiter.assert(aggregate, 120);
      limiter.assert(firstFlow, 10);
    }
    limiter.assert(aggregate, 120);
    expect(() => limiter.assert(firstFlow, 10)).toThrowError(HttpError);

    for (let count = 11; count < 120; count += 1) {
      const flow = requestRateLimitKey(request, route, new URL(`https://crm.nikufra.ai/api/outreach/v1/unsubscribe/token-${count}`));
      limiter.assert(aggregate, 120);
      limiter.assert(flow, 10);
    }
    expect(() => limiter.assert(aggregate, 120)).toThrowError(HttpError);
  });

  it("keeps aggregate and per-flow buckets distinct even when a callback or webhook identity is absent", () => {
    const request = { headers: {}, socket: { remoteAddress: "198.51.100.42" } } as never;
    for (const route of ["/api/outreach/v1/oauth/callback/google", "/api/outreach/v1/webhooks/smtp_imap"]) {
      const url = new URL(`https://crm.nikufra.ai${route}`);
      expect(requestRateLimitKey(request, route, url)).not.toBe(aggregateRateLimitKey(request, route));
      expect(requestRateLimitKey(request, route, url)).toMatch(/^flow:/);
      expect(aggregateRateLimitKey(request, route)).toMatch(/^aggregate:/);
    }
  });

  it("does not leak provider or database details in a 5xx response", () => {
    const output = publicError(new Error("password=top-secret host=internal"), "request-1");
    expect(output.status).toBe(500);
    expect(JSON.stringify(output.body)).not.toContain("top-secret");
  });

  it("returns schema failures as a bounded 400 response instead of a 500", () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "not-an-email" });
    if (result.success) throw new Error("expected validation failure");
    const output = publicError(result.error, "request-validation");
    expect(output).toMatchObject({ status: 400, body: { error: { code: "validation_error", requestId: "request-validation" } } });
  });

  it("blocks SMTP/IMAP SSRF to loopback and insecure TLS", async () => {
    await expect(resolveMailEndpoint("127.0.0.1", true)).rejects.toThrow(/interno|público/);
    await expect(resolveMailEndpoint("mail.example.com", false)).rejects.toThrow(/TLS/);
  });
});
