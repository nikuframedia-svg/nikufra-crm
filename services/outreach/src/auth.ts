import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";
import type { Actor, Capability, OutreachRole } from "./types.js";

const adminCapabilities = new Set<Capability>([
  "outreach.read",
  "outreach.thread.handle",
  "outreach.thread.assign",
  "outreach.campaign.manage",
  "outreach.campaign.launch",
  "outreach.mailbox.manage",
  "outreach.suppression.manage",
  "outreach.admin",
]);

export function capabilitiesFor(crmRole: "admin" | "member", outreachRole: OutreachRole) {
  if (crmRole === "admin") return new Set(adminCapabilities);
  const capabilities = new Set<Capability>(["outreach.read"]);
  if (outreachRole === "sales_rep") capabilities.add("outreach.thread.handle");
  if (outreachRole === "campaign_manager") {
    capabilities.add("outreach.thread.handle");
    capabilities.add("outreach.thread.assign");
    capabilities.add("outreach.campaign.manage");
    capabilities.add("outreach.campaign.launch");
  }
  return capabilities;
}

export function bearerToken(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "authentication_required", "É necessária uma sessão válida do CRM.");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new HttpError(401, "authentication_required", "É necessária uma sessão válida do CRM.");
  return token;
}

export async function authenticate(request: IncomingMessage): Promise<Actor> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${bearerToken(request)}`, apikey: config.supabaseAnonKey },
  });
  if (!response.ok) throw new HttpError(401, "invalid_session", "A sessão expirou ou deixou de ser válida.");
  const user = await response.json() as { id?: string; email?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new HttpError(401, "invalid_session", "Não foi possível identificar o utilizador.");

  const result = await pool.query<{
    id: string;
    nome: string;
    email: string;
    role: "admin" | "member";
    ativo: boolean;
    outreach_role: OutreachRole | null;
  }>(
    `select id, nome, email, role::text as role, ativo, coalesce(outreach_role::text, 'viewer') as outreach_role
       from public.profiles where id = $1`,
    [user.id],
  );
  const profile = result.rows[0];
  if (!profile?.ativo) throw new HttpError(403, "inactive_profile", "A conta CRM não está ativa.");
  const outreachRole = profile.outreach_role ?? "viewer";
  if (config.adminOnly && profile.role !== "admin") {
    throw new HttpError(403, "dark_deploy_admin_only", "O módulo Outreach ainda está em dark deploy e só está disponível a administradores.");
  }
  return {
    id: profile.id,
    email: profile.email || user.email || "",
    name: profile.nome,
    crmRole: profile.role,
    outreachRole,
    capabilities: capabilitiesFor(profile.role, outreachRole),
  };
}

export function requireCapability(actor: Actor, capability: Capability) {
  if (!actor.capabilities.has(capability)) {
    throw new HttpError(403, "insufficient_capability", "A tua função não permite esta ação.", { required: capability });
  }
}

export function assertOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (origin && !config.corsOrigins.has(origin)) throw new HttpError(403, "origin_not_allowed", "Origem não permitida.");
}
