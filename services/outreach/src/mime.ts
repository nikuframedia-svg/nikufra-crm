import { createHash } from "node:crypto";

function encodedWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function safeAddress(value: string) {
  return value.replace(/[\r\n<>]/g, "").trim();
}

function safeMessageId(value: string) {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  const match = cleaned.match(/<([^<>\s]+@[^<>\s]+)>/) ?? cleaned.match(/^([^<>\s]+@[^<>\s]+)$/);
  return match?.[1] ? `<${match[1]}>` : null;
}

export function buildMime(input: {
  idempotencyKey: string;
  senderName: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
  inReplyTo?: string | null;
  references?: string[];
}) {
  const messageKey = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 40);
  const domain = input.from.split("@")[1]?.replace(/[^a-z0-9.-]/gi, "") || "invalid.local";
  const internetMessageId = `<outreach-${messageKey}@${domain}>`;
  const headers = [
    `From: ${encodedWord(input.senderName)} <${safeAddress(input.from)}>`,
    `To: <${safeAddress(input.to)}>`,
    `Subject: ${encodedWord(input.subject.replace(/[\r\n]/g, " "))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${internetMessageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `List-Unsubscribe: <${input.unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    `X-Nikufra-Idempotency-Key: ${input.idempotencyKey.replace(/[^A-Za-z0-9._:-]/g, "")}`,
  ];
  const inReplyTo = input.inReplyTo ? safeMessageId(input.inReplyTo) : null;
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  const references = [...(input.references ?? []), ...(input.inReplyTo ? [input.inReplyTo] : [])];
  const safeReferences = [...new Set(references.map(safeMessageId).filter((value): value is string => Boolean(value)))];
  if (safeReferences.length) headers.push(`References: ${safeReferences.join(" ")}`);
  const body = Buffer.from(input.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return { raw: `${headers.join("\r\n")}\r\n\r\n${body}\r\n`, internetMessageId };
}

export function htmlToText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
