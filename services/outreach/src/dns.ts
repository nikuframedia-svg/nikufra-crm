import { promises as dns } from "node:dns";
import { usableMxRecords } from "./verification.js";

const publicDns = new dns.Resolver();
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);

async function txt(name: string) {
  try {
    return (await publicDns.resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

export function assessSpf(records: string[], provider: "google" = "google") {
  const matches = records.filter((record) => /^v=spf1(?:\s|$)/i.test(record.trim()));
  if (matches.length !== 1) return { status: matches.length ? "warning" as const : "missing" as const, records: matches };
  const mechanisms = matches[0]?.trim().split(/\s+/).slice(1) ?? [];
  const permitsEverybody = mechanisms.some((mechanism) => /^(?:\+)?all$/i.test(mechanism));
  // Outreach only certifies Google in the first rollout. Generic `a`, `mx`
  // or an unrelated include (for example Outlook) does not authorize Gmail's
  // outbound infrastructure and must never unlock a mailbox.
  const authorizesSender = provider === "google" && mechanisms.some((mechanism) =>
    /^(?:\+)?include:_spf\.google\.com$/i.test(mechanism)
      || /^redirect=_spf\.google\.com$/i.test(mechanism));
  return { status: authorizesSender && !permitsEverybody ? "pass" as const : "warning" as const, records: matches };
}

export function assessDkim(records: string[], selector: string) {
  if (!selector) return { status: "not_checked" as const, records };
  const matches = records.filter((record) => /(?:^|;)\s*p\s*=/i.test(record));
  const key = matches[0]?.match(/(?:^|;)\s*p\s*=\s*([^;]*)/i)?.[1]?.replace(/\s/g, "") ?? "";
  // Refuse obsolete short DKIM material. A 1024-bit key is the minimum
  // accepted for rollout; production should normally publish 2048-bit keys.
  const usable = matches.length === 1 && /^[a-z0-9+/]+={0,2}$/i.test(key) && Buffer.from(key, "base64").length >= 128;
  return { status: usable ? "pass" as const : matches.length ? "warning" as const : "missing" as const, records: matches };
}

export function assessDmarc(records: string[]) {
  const matches = records.filter((record) => /^v=dmarc1\s*(?:;|$)/i.test(record.trim()));
  const record = matches[0] ?? null;
  const policy = record?.match(/(?:^|;)\s*p\s*=\s*([^;\s]+)/i)?.[1]?.toLowerCase() ?? null;
  const valid = matches.length === 1 && ["none", "quarantine", "reject"].includes(policy ?? "");
  // p=none is a valid DMARC policy for sender authentication. It monitors
  // failures without asking receivers to quarantine or reject them. Keep the
  // enforcement distinction in the details, not in the send-readiness gate.
  return { status: !record ? "missing" as const : valid ? "pass" as const : "warning" as const, record, policy, validForSending: valid, enforced: policy === "quarantine" || policy === "reject" };
}

export function assessMx<T extends { exchange: string; priority: number }>(records: T[], provider: "google" = "google") {
  const usable = usableMxRecords(records).toSorted((left, right) => left.priority - right.priority);
  if (!usable.length) return { status: "missing" as const, hosts: usable };
  // A Google OAuth mailbox must actually receive mail in Google. Accept both
  // the current smtp.google.com target and the legacy Google Workspace MX set.
  const providerReady = provider === "google" && usable.some((record) => {
    const exchange = record.exchange.trim().toLowerCase().replace(/\.$/, "");
    return exchange === "smtp.google.com" || exchange.endsWith(".google.com");
  });
  return { status: providerReady ? "pass" as const : "warning" as const, hosts: usable };
}

export async function inspectDomain(domainInput: string, selectorInput = "google") {
  const domain = domainInput.trim().toLowerCase().replace(/^@/, "");
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain)) throw new Error("Domínio inválido.");
  const selector = selectorInput.trim().toLowerCase();
  const [rootTxt, dmarcRecords, mxRecords, dkimRecords, mtaStsRecords] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    publicDns.resolveMx(domain).catch(() => []),
    txt(`${selector}._domainkey.${domain}`),
    txt(`_mta-sts.${domain}`),
  ]);
  return {
    checkerVersion: 4,
    domain,
    selector,
    spf: assessSpf(rootTxt),
    dkim: assessDkim(dkimRecords, selector),
    dmarc: assessDmarc(dmarcRecords),
    mx: assessMx(mxRecords),
    mtaSts: { configured: mtaStsRecords.some((record) => record.toLowerCase().startsWith("v=stsv1")), records: mtaStsRecords },
    checkedAt: new Date().toISOString(),
  };
}
