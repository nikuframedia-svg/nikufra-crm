import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { domainToASCII } from "node:url";

const blockedIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(address, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [address, prefix] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]] as const) {
  blockedIpv6.addSubnet(address, prefix, "ipv6");
}

function normalizeHost(host: string) {
  const trimmed = host.trim().replace(/^\[|\]$/g, "");
  if (!trimmed || trimmed.includes("%") || /\s/.test(trimmed)) throw new Error("Host SMTP/IMAP inválido.");
  if (isIP(trimmed)) return trimmed;
  const ascii = domainToASCII(trimmed.replace(/\.$/, "")).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Host SMTP/IMAP inválido.");
  return ascii;
}

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family === 6) return globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
  return false;
}

export async function resolveMailEndpoint(host: string, rejectUnauthorized: boolean) {
  if (!rejectUnauthorized) throw new Error("A validação TLS é obrigatória em servidores externos.");
  const name = normalizeHost(host);
  const addresses = isIP(name) ? [{ address: name }] : await Promise.race([
    lookup(name, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("DNS SMTP/IMAP excedeu 5 segundos.")), 5_000)),
  ]);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Host SMTP/IMAP resolve para um endereço interno ou não público.");
  return { address: addresses[0]!.address, servername: isIP(name) ? undefined : name };
}
