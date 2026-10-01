import type { InboundProviderMessage } from "./types.js";

const permanentStatus = /(?:^|[\s;:])(?:5[.][0-9]{1,3}[.][0-9]{1,3}|5[0-9]{2})(?=$|[\s;:.,\-])/m;
const temporaryStatus = /(?:^|[\s;:])(?:4[.][0-9]{1,3}[.][0-9]{1,3}|4[0-9]{2})(?=$|[\s;:.,\-])/m;
const address = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

function unique(values: string[]) {
  return [...new Set(values)];
}

function fieldValues(text: string, names: string[]) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [...text.matchAll(new RegExp(`^(?:${escaped})\\s*:\\s*(.+)$`, "gim"))].map((match) => match[1] ?? "");
}

function fieldEmails(text: string) {
  return unique(fieldValues(text, ["Final-Recipient", "Original-Recipient", "Original-Rcpt-To", "X-Failed-Recipients"])
    .flatMap((value) => value.match(address) ?? [])
    .map((value) => value.toLowerCase()));
}

function originalMessageIds(text: string) {
  return unique(fieldValues(text, ["Original-Message-ID", "Original-Message-Id"])
    .flatMap((value) => value.match(/<[^<>\s]+@[^<>\s]+>/g) ?? []));
}

export interface DeliverySignal {
  kind: "hard_bounce" | "soft_bounce" | "complaint";
  recipients: string[];
  referencedMessageIds: string[];
}

export function deliverySignal(message: InboundProviderMessage): DeliverySignal | null {
  const headers = Object.fromEntries(Object.entries(message.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const contentType = headers["content-type"] ?? "";
  const structuredHeaders = [
    ["Final-Recipient", headers["final-recipient"]],
    ["Original-Recipient", headers["original-recipient"]],
    ["Original-Rcpt-To", headers["original-rcpt-to"]],
    ["X-Failed-Recipients", headers["x-failed-recipients"]],
    ["Original-Message-ID", headers["original-message-id"]],
    ["Feedback-Type", headers["feedback-type"]],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}: ${value}`).join("\n");
  const report = `${structuredHeaders}\n${message.text}`;
  const diagnostic = `${message.from}\n${message.subject}\n${report}`;
  const feedbackType = `${headers["feedback-type"] ?? ""}\n${fieldValues(message.text, ["Feedback-Type"]).join("\n")}`;
  const isArf = /report-type\s*=\s*["']?feedback-report/i.test(contentType)
    || /\b(?:abuse|fraud|virus|other)\b/i.test(feedbackType)
    || /\b(?:complaint feedback loop|abuse report|feedback report)\b/i.test(message.subject);
  const references = unique([
    ...(message.inReplyTo ? [message.inReplyTo] : []),
    ...message.references,
    ...originalMessageIds(report),
  ]);
  if (isArf) return { kind: "complaint", recipients: fieldEmails(report), referencedMessageIds: references };

  const isDeliveryReport = /report-type\s*=\s*["']?delivery-status/i.test(contentType)
    || /(?:mailer-daemon|postmaster)@|\b(?:delivery status notification|delivery failed|undeliverable|mail delivery failed|n[aã]o entregue)\b/i.test(`${message.from}\n${message.subject}`)
    || /^(?:Final-Recipient|Original-Recipient|X-Failed-Recipients)\s*:/im.test(message.text);
  if (!isDeliveryReport) return null;
  if (permanentStatus.test(diagnostic)) return { kind: "hard_bounce", recipients: fieldEmails(report), referencedMessageIds: references };
  if (temporaryStatus.test(diagnostic)) return { kind: "soft_bounce", recipients: fieldEmails(report), referencedMessageIds: references };
  return null;
}

export function normalizedWebhookDeliveryEvent(payload: Record<string, unknown>) {
  const type = String(payload.type ?? payload.eventType ?? payload.event ?? "").toLowerCase().replace(/-/g, "_");
  const diagnostic = ["status", "statusCode", "smtpCode", "diagnostic", "reason"]
    .map((key) => payload[key])
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .join(" ");
  const kind = type === "complaint"
    ? "complaint"
    : type === "hard_bounce" || (type === "bounce" && permanentStatus.test(diagnostic))
      ? "hard_bounce"
      : null;
  if (!kind) return null;
  const emailValue = [payload.email, payload.recipient, payload.to].find((value): value is string => typeof value === "string" && value.includes("@"));
  const email = emailValue?.match(address)?.[0]?.toLowerCase() ?? null;
  const providerMessageId = [payload.providerMessageId, payload.messageId].find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
  return { kind, email, providerMessageId } as const;
}
