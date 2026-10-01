import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

const MAX_JSON_BYTES = 1_000_000;

export function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cache-control", "no-store");
}

export function setCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin && config.corsOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-credentials", "true");
  }
  response.setHeader("access-control-allow-headers", "authorization, content-type, idempotency-key, x-request-id, x-outreach-signature");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

export function json(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function html(response: ServerResponse, status: number, payload: string) {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.end(payload);
}

export async function readRaw(request: IncomingMessage, limit = MAX_JSON_BYTES) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new HttpError(413, "payload_too_large", "O pedido excede o tamanho permitido.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(request: IncomingMessage) {
  const raw = await readRaw(request);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "O corpo do pedido não contém JSON válido.");
  }
}

export function pageParams(url: URL) {
  const page = Math.max(1, Math.min(100_000, Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize")) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function singleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function safeRequestLogFields(request: Pick<IncomingMessage, "method">, route: string) {
  // Deliberately accepts no URL. OAuth state, unsubscribe tokens and webhook
  // query secrets can therefore never be serialized by this helper.
  return { method: request.method ?? "UNKNOWN", route };
}
