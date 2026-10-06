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

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function outreachRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async (token: string | null) => {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: "same-origin",
      });
    } catch {
      throw new OutreachApiError("O serviço Outreach não está disponível. O restante CRM continua operacional.", 0, "service_unavailable");
    }
  };
  let response = await send(await accessToken());
  let raw = response.status === 204 ? null : await response.json().catch(() => null) as (ApiErrorBody & { data?: unknown }) | null;
  if (response.status === 401 && raw?.error?.code === "invalid_session" && supabase) {
    const { data, error } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error("refresh_failed") }));
    if (error || !data.session?.access_token) {
      throw new OutreachApiError("A sessão expirou. Entra novamente no CRM e repete a operação.", 401, "invalid_session");
    }
    response = await send(data.session.access_token);
    raw = response.status === 204 ? null : await response.json().catch(() => null) as (ApiErrorBody & { data?: unknown }) | null;
  }
  if (!response.ok) {
    const message = response.status === 401 && raw?.error?.code === "invalid_session"
      ? "A sessão expirou. Entra novamente no CRM e repete a operação."
      : raw?.error?.message ?? raw?.message ?? `O pedido Outreach falhou (${response.status}).`;
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
