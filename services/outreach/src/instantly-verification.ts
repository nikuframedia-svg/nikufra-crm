import { z } from "zod";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import { audit } from "./repository.js";
import type { Actor } from "./types.js";

type VerificationStatus = "pending" | "valid" | "invalid" | "catch_all" | "unknown";
type VerificationResult = {
  contactId: string;
  email: string | null;
  status: VerificationStatus;
  reason: string;
  cached: boolean;
};

const requestSchema = z.object({
  contactIds: z.array(z.uuid()).min(1).max(5).refine((ids) => new Set(ids).size === ids.length),
  acknowledgeProviderTransfer: z.literal(true),
}).strict();

const providerSchema = z.object({
  email: z.email(),
  verification_status: z.enum(["pending", "verified", "invalid"]),
  catch_all: z.union([z.boolean(), z.literal("pending")]).nullish(),
});

export function mapInstantlyResult(input: z.infer<typeof providerSchema>): { status: VerificationStatus; reason: string } {
  if (input.verification_status === "pending") return { status: "pending", reason: "Verificação ainda em curso no fornecedor." };
  if (input.verification_status === "invalid") return { status: "invalid", reason: "O fornecedor classificou a caixa como inválida." };
  if (input.catch_all === true) return { status: "catch_all", reason: "Domínio catch-all; a existência desta caixa não ficou confirmada." };
  if (input.catch_all !== false) return { status: "pending", reason: "A classificação catch-all ainda não está concluída." };
  return { status: "valid", reason: "Caixa validada pelo fornecedor." };
}

async function providerRequest(email: string, method: "POST" | "GET") {
  const path = method === "POST" ? "/api/v2/email-verification" : `/api/v2/email-verification/${encodeURIComponent(email)}`;
  let response: Response;
  try {
    response = await fetch(`https://api.instantly.ai${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.instantlyApiKey}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify({ email }) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(503, "verification_provider_unavailable", "O fornecedor de verificação não respondeu. Tenta novamente mais tarde.");
  }
  if (!response.ok) {
    if (response.status === 402) throw new HttpError(402, "verification_credits_required", "Sem plano ou créditos de verificação disponíveis na Instantly.");
    if (response.status === 401 || response.status === 403) throw new HttpError(503, "verification_provider_authorization", "A chave da Instantly não tem acesso à verificação. Confirma os scopes e os créditos.");
    if (response.status === 429) throw new HttpError(503, "verification_provider_rate_limited", "A Instantly limitou os pedidos. Tenta novamente mais tarde.");
    throw new HttpError(503, "verification_provider_error", "A Instantly não conseguiu verificar este email agora.");
  }
  const parsed = providerSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.email.toLowerCase() !== email.toLowerCase()) {
    throw new HttpError(502, "verification_provider_response_invalid", "A Instantly devolveu um resultado inesperado; o email não foi validado.");
  }
  return mapInstantlyResult(parsed.data);
}

type VerificationRow = {
  id: string;
  status: VerificationStatus;
  reason: string | null;
  created_at: Date;
};

async function reserveVerification(contactId: string, email: string) {
  return transaction(async (client) => {
    // A second request for the same address must reuse the first request's
    // pending row rather than spend verification credits twice. The global
    // lock also makes the paid daily budget exact under concurrent requests.
    await client.query(`select pg_advisory_xact_lock(20261004,2)`);
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [email]);
    const existing = await client.query<VerificationRow>(`
      select id,status::text status,reasons[1] reason,created_at
      from public.outreach_email_verifications
      where email=$1 and provider='instantly' and expires_at>now()
      order by created_at desc,id desc limit 1`, [email]);
    if (existing.rows[0]) return { row: existing.rows[0], created: false };
    const used = await client.query<{ count: string }>(`
      select count(*)::text count from public.outreach_email_verifications
      where provider='instantly' and created_at>=date_trunc('day',now())`);
    if (Number(used.rows[0]?.count ?? 0) >= config.instantlyDailyLimit) {
      throw new HttpError(429, "verification_daily_limit", "O limite diário de verificações foi atingido. Tenta amanhã ou pede ao administrador para rever o limite.");
    }
    const inserted = await client.query<VerificationRow>(`
      insert into public.outreach_email_verifications(contact_id,email,status,provider,reasons,verified_at,expires_at)
      values($1,$2,'pending','instantly',array['A aguardar o fornecedor.'],now(),now()+interval '1 day')
      returning id,status::text status,reasons[1] reason,created_at`, [contactId, email]);
    return { row: inserted.rows[0]!, created: true };
  });
}

async function saveResult(id: string, result: { status: VerificationStatus; reason: string }) {
  const validity = result.status === "pending" ? "1 day" : result.status === "unknown" ? "5 minutes" : "30 days";
  await pool.query(`
    update public.outreach_email_verifications
    set status=$2,reasons=array[$3::text],verified_at=now(),expires_at=now()+$4::interval
    where id=$1 and provider='instantly'`, [id, result.status, result.reason, validity]);
}

async function verifyOne(contactId: string, email: string): Promise<VerificationResult> {
  if (!z.email().safeParse(email).success) {
    return { contactId, email, status: "invalid", reason: "Sintaxe de email inválida; não foi enviado ao fornecedor.", cached: false };
  }
  const { row, created } = await reserveVerification(contactId, email);
  if (!created && row.status !== "pending") {
    return { contactId, email, status: row.status, reason: row.reason ?? "Resultado anterior ainda válido.", cached: true };
  }
  if (!created && Date.now() - new Date(row.created_at).getTime() < 15_000) {
    return { contactId, email, status: "pending", reason: "Verificação ainda em curso no fornecedor.", cached: true };
  }
  try {
    const result = await providerRequest(email, created ? "POST" : "GET");
    await saveResult(row.id, result);
    return { contactId, email, ...result, cached: false };
  } catch (error) {
    const reason = error instanceof HttpError ? error.message : "O fornecedor não respondeu.";
    // A timed-out POST may still have reached the provider and consumed
    // credits. Keep its reservation so the next click checks status via GET.
    const ambiguousPost = created && error instanceof HttpError && [
      "verification_provider_unavailable", "verification_provider_error", "verification_provider_response_invalid",
    ].includes(error.code);
    const status = ambiguousPost ? "pending" : "unknown";
    await saveResult(row.id, { status, reason });
    return { contactId, email, status, reason, cached: false };
  }
}

export function instantlyVerificationSettings() {
  return { provider: "instantly" as const, configured: Boolean(config.instantlyApiKey) };
}

export async function verifyLeadsWithInstantly(actor: Actor, raw: unknown) {
  const input = requestSchema.parse(raw);
  if (!config.instantlyApiKey) throw new HttpError(503, "verification_provider_not_configured", "A verificação de caixas ainda não está ligada. Configura a chave da Instantly no servidor.");
  const contacts = await pool.query<{ id: string; email: string | null; optout: boolean }>(`
    select id,email::text,optout from public.contactos where id=any($1::uuid[])`, [input.contactIds]);
  const byId = new Map(contacts.rows.map((row) => [row.id, row]));
  const items = await Promise.all(input.contactIds.map(async (id): Promise<VerificationResult> => {
    const contact = byId.get(id);
    if (!contact?.email) return { contactId: id, email: contact?.email ?? null, status: "unknown", reason: "Contacto sem email ou inexistente.", cached: false };
    if (contact.optout) return { contactId: id, email: contact.email, status: "unknown", reason: "Contacto com opt-out; não enviado ao fornecedor.", cached: false };
    return verifyOne(id, contact.email.trim().toLowerCase());
  }));
  await audit(actor.id, "contacts.provider_verified", "contact", null, {
    provider: "instantly", count: items.length,
    results: items.map(({ contactId, status, cached }) => ({ contactId, status, cached })),
  });
  return { items };
}
