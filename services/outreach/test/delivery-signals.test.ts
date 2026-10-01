import { describe, expect, it } from "vitest";
import { deliverySignal, normalizedWebhookDeliveryEvent } from "../src/delivery-signals.js";
import type { InboundProviderMessage } from "../src/types.js";

function inbound(overrides: Partial<InboundProviderMessage> = {}): InboundProviderMessage {
  return {
    providerMessageId: "dsn-1",
    providerThreadId: null,
    internetMessageId: "<dsn@example.net>",
    inReplyTo: null,
    references: [],
    from: "Mail Delivery Subsystem <mailer-daemon@example.net>",
    subject: "Delivery Status Notification (Failure)",
    text: "",
    receivedAt: "2026-09-30T12:00:00.000Z",
    autoSubmitted: "auto-replied",
    headers: { "content-type": "multipart/report; report-type=delivery-status" },
    ...overrides,
  };
}

describe("delivery signal parsing", () => {
  it("maps a permanent DSN using its original recipient and message id", () => {
    const signal = deliverySignal(inbound({ text: [
      "Final-Recipient: rfc822; lead@example.com",
      "Original-Message-ID: <sent-1@nikufra.ai>",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 mailbox unavailable",
    ].join("\n") }));

    expect(signal).toEqual({
      kind: "hard_bounce",
      recipients: ["lead@example.com"],
      referencedMessageIds: ["<sent-1@nikufra.ai>"],
    });
  });

  it("keeps a transient 4xx DSN separate from a hard bounce", () => {
    expect(deliverySignal(inbound({ text: "Original-Recipient: rfc822; lead@example.com\nStatus: 4.2.0\nDiagnostic-Code: smtp; 421 try later" })))
      .toMatchObject({ kind: "soft_bounce" });
  });

  it("maps an ARF complaint and its original envelope fields", () => {
    const signal = deliverySignal(inbound({
      subject: "Complaint feedback loop",
      headers: { "content-type": "multipart/report; report-type=feedback-report" },
      text: "Feedback-Type: abuse\nOriginal-Rcpt-To: rfc822; victim@example.com\nOriginal-Message-ID: <sent-2@nikufra.ai>",
    }));
    expect(signal).toEqual({
      kind: "complaint",
      recipients: ["victim@example.com"],
      referencedMessageIds: ["<sent-2@nikufra.ai>"],
    });
  });

  it("normalizes only permanent bounce and complaint webhook events", () => {
    expect(normalizedWebhookDeliveryEvent({ type: "bounce", status: "550 5.1.1", recipient: "Lead <lead@example.com>", messageId: "m-1" }))
      .toEqual({ kind: "hard_bounce", email: "lead@example.com", providerMessageId: "m-1" });
    expect(normalizedWebhookDeliveryEvent({ type: "bounce", status: "421 4.2.0", recipient: "lead@example.com" })).toBeNull();
    expect(normalizedWebhookDeliveryEvent({ event: "complaint", email: "lead@example.com" }))
      .toMatchObject({ kind: "complaint", email: "lead@example.com" });
  });
});
