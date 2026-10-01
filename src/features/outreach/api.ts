import { supabase } from "../../lib/supabase";
import type { ApiErrorBody, Collection } from "./types";

const API_BASE = "/api/outreach/v1";

export class OutreachApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = "OutreachApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()), normalizeKeys(item)]));
}

async function authHeaders(): Promise<HeadersInit> {
  if (!supabase) return { "Content-Type": "application/json" };
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

export async function outreachRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(await authHeaders()), ...init.headers },
      credentials: "same-origin",
    });
  } catch {
    throw new OutreachApiError("O serviço Outreach não está disponível. O restante CRM continua operacional.", 0, "service_unavailable");
  }

  const raw = response.status === 204 ? null : await response.json().catch(() => null) as (ApiErrorBody & { data?: unknown }) | null;
  if (!response.ok) {
    const message = raw?.error?.message ?? raw?.message ?? `O pedido Outreach falhou (${response.status}).`;
    throw new OutreachApiError(message, response.status, raw?.error?.code, raw?.error?.requestId);
  }
  const data = raw && "data" in raw ? raw.data : raw;
  return normalizeKeys(data) as T;
}

export function asCollection<T>(value: Collection<T> | T[] | null | undefined): Collection<T> {
  if (Array.isArray(value)) return { items: value };
  return value ?? { items: [] };
}

export function postJson<T>(path: string, body?: unknown) {
  return outreachRequest<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patchJson<T>(path: string, body: unknown) {
  return outreachRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteJson<T>(path: string, body?: unknown) {
  return outreachRequest<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });
}
