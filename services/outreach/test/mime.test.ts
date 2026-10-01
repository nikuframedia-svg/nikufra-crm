import { describe, expect, it } from "vitest";
import { buildMime } from "../src/mime.js";

describe("outbound MIME", () => {
  it("is deterministic per idempotency key and includes RFC 8058 headers", () => {
    const input = { idempotencyKey: "same-key", senderName: "Nikufra", from: "maria@nikufra.ai", to: "lead@example.com", subject: "Olá", text: "Mensagem", unsubscribeUrl: "https://crm.nikufra.ai/api/outreach/v1/unsubscribe/token" };
    const first = buildMime(input);
    const second = buildMime(input);
    expect(first.internetMessageId).toBe(second.internetMessageId);
    expect(first.raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(first.raw).toContain("X-Nikufra-Idempotency-Key: same-key");
  });

  it("strips CRLF from user-controlled headers", () => {
    const message = buildMime({ idempotencyKey: "safe", senderName: "A\r\nBcc: victim@example.com", from: "a@nikufra.ai", to: "b@example.com", subject: "Hi\r\nBcc: victim@example.com", text: "ok", unsubscribeUrl: "https://example.com/u" });
    expect(message.raw).not.toMatch(/\r\nBcc:/);
  });
});
