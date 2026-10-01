import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { HttpError } from "./errors.js";

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedIp(raw: string | undefined) {
  if (!raw) return null;
  let value = raw.trim().replace(/^"|"$/g, "");
  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing > 0) value = value.slice(1, closing);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  value = value.replace(/%.+$/, "");
  if (value.toLowerCase().startsWith("::ffff:")) value = value.slice(7);
  return isIP(value) ? value.toLowerCase() : null;
}

export function isTrustedProxyAddress(raw: string | undefined) {
  const address = normalizedIp(raw);
  if (!address) return false;
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 169 && octets[1] === 254);
  }
  return address === "::1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

export function clientAddress(request: Pick<IncomingMessage, "headers" | "socket">) {
  const remote = normalizedIp(request.socket.remoteAddress) ?? "unknown";
  if (!isTrustedProxyAddress(remote)) return remote;
  const forwarded = firstHeader(request.headers["x-forwarded-for"]);
  if (!forwarded || forwarded.length > 512) return remote;
  const entries = forwarded.split(",").slice(0, 8);
  // Caddy appends the directly observed client at the right-hand side. Reading
  // from the right prevents a caller-provided leading XFF value from winning.
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = normalizedIp(entries[index]);
    if (candidate) return candidate;
  }
  return remote;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function aggregateRateLimitKey(
  request: Pick<IncomingMessage, "headers" | "socket">,
  routePath: string,
) {
  return `aggregate:${clientAddress(request)}:${routePath}`;
}

export function requestRateLimitKey(
  request: Pick<IncomingMessage, "headers" | "socket">,
  routePath: string,
  url: URL,
) {
  let flowIdentity = "";
  if (routePath.includes("/unsubscribe/:token")) {
    flowIdentity = url.pathname.split("/").at(-1) ?? "";
  } else if (routePath.includes("/oauth/callback/")) {
    flowIdentity = url.searchParams.get("state") ?? "";
  } else if (routePath.includes("/webhooks/")) {
    flowIdentity = firstHeader(request.headers["x-provider-event-id"])
      ?? firstHeader(request.headers["x-goog-message-number"])
      ?? "";
  }
  const suffix = flowIdentity ? `:${shortHash(flowIdentity)}` : "";
  return `flow:${clientAddress(request)}:${routePath}${suffix}`;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 10_000) {}

  assert(key: string, max: number, windowMs = 60_000) {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.windows.size >= this.maxKeys) {
        this.prune();
        while (this.windows.size >= this.maxKeys) {
          const oldest = this.windows.keys().next().value as string | undefined;
          if (!oldest) break;
          this.windows.delete(oldest);
        }
      }
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > max) throw new HttpError(429, "rate_limited", "Foram feitos demasiados pedidos. Tenta novamente dentro de um minuto.");
  }

  prune() {
    const now = this.now();
    for (const [key, value] of this.windows) if (value.resetAt <= now) this.windows.delete(key);
  }

  get size() {
    return this.windows.size;
  }
}
