import { promises as dns } from "node:dns";

const disposableDomains = new Set([
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "tempmail.com", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
]);
const rolePrefixes = new Set(["admin", "billing", "contact", "hello", "info", "office", "sales", "support", "team"]);

export interface EmailVerification {
  email: string;
  status: "verified" | "risky" | "invalid" | "unknown";
  reason: string;
  mxHosts: { exchange: string; priority: number }[];
  disposable: boolean;
  roleAddress: boolean;
  checkedAt: string;
}

export function usableMxRecords<T extends { exchange: string }>(records: T[]) {
  return records.filter((record) => {
    const exchange = record.exchange.trim();
    // RFC 7505 null MX explicitly declares that a domain accepts no mail.
    return exchange.length > 0 && exchange !== ".";
  });
}

function dnsErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

async function checkAddressFallback(domain: string): Promise<"available" | "absent" | "unknown"> {
  // SMTP uses an implicit MX pointing to A/AAAA when a domain has no MX.
  const answers = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  if (answers.some((answer) => answer.status === "fulfilled" && answer.value.length > 0)) return "available";
  if (answers.some((answer) => answer.status === "rejected" && !["ENODATA", "ENOTFOUND"].includes(dnsErrorCode(answer.reason)))) return "unknown";
  return "absent";
}

export async function verifyEmailAddress(input: string): Promise<EmailVerification> {
  const email = input.trim().toLowerCase();
  const match = /^([^\s@]+)@([^\s@]+)$/.exec(email);
  if (!match?.[1] || !match[2]) return { email, status: "invalid", reason: "Sintaxe de email inválida.", mxHosts: [], disposable: false, roleAddress: false, checkedAt: new Date().toISOString() };
  const local = match[1];
  const domain = match[2];
  const disposable = disposableDomains.has(domain);
  const roleAddress = rolePrefixes.has(local.split(/[+._-]/)[0] ?? "");
  let publishedMx: { exchange: string; priority: number }[];
  try {
    publishedMx = await dns.resolveMx(domain);
  } catch (error) {
    const code = dnsErrorCode(error);
    if (code !== "ENODATA" && code !== "ENOTFOUND") return { email, status: "unknown", reason: "Não foi possível consultar o DNS agora.", mxHosts: [], disposable, roleAddress, checkedAt: new Date().toISOString() };
    publishedMx = [];
  }
  const mxHosts = usableMxRecords(publishedMx);
  const checkedAt = new Date().toISOString();
  if (publishedMx.length && !mxHosts.length) return { email, status: "invalid", reason: "O domínio anuncia que não recebe email (null MX).", mxHosts: [], disposable, roleAddress, checkedAt };
  if (!mxHosts.length) {
    const fallback = await checkAddressFallback(domain);
    if (fallback === "absent") return { email, status: "invalid", reason: "O domínio não tem MX nem registos A/AAAA para receber email.", mxHosts: [], disposable, roleAddress, checkedAt };
    if (fallback === "unknown") return { email, status: "unknown", reason: "Não foi possível confirmar os registos DNS do domínio agora.", mxHosts: [], disposable, roleAddress, checkedAt };
  }
  if (disposable) return { email, status: "risky", reason: "Domínio de email temporário conhecido.", mxHosts, disposable, roleAddress, checkedAt };
  if (roleAddress) return { email, status: "risky", reason: "Endereço funcional/partilhado; confirma destinatário e base legal.", mxHosts, disposable, roleAddress, checkedAt };
  // DNS proves only that the domain accepts mail; it cannot prove that this
  // particular mailbox exists. Persisting DNS-only checks as `valid` would let
  // an invented address pass the final dispatch eligibility gate for 30 days.
  return { email, status: "unknown", reason: "Domínio com MX válido, mas a existência desta mailbox não foi confirmada.", mxHosts, disposable, roleAddress, checkedAt };
}
