import { Webhook } from "standardwebhooks";
import { adminClient, decryptToken, gmailAccessToken } from "../_shared/security.ts";

type HookUser = {
  email?: string;
  new_email?: string;
  user_metadata?: { nome?: string };
};

type EmailData = {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type?: string;
  token_new?: string;
  token_hash_new?: string;
  old_email?: string;
  provider?: string;
  factor_type?: string;
};

type HookPayload = { user: HookUser; email_data: EmailData };
type OutgoingEmail = { recipient: string; action: string; tokenHash: string; subject: string; text: string; html: string };

const LINK_ACTIONS = new Set(["signup", "recovery", "invite", "magiclink", "email_change", "email_change_current", "email_change_new"]);

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && !/[\r\n]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function actionCopy(action: string) {
  switch (action) {
    case "invite": return { subject: "Convite para o Nikufra CRM", heading: "Foste convidado para o Nikufra CRM", button: "Aceitar convite" };
    case "magiclink": return { subject: "O teu acesso ao Nikufra CRM", heading: "Entrar no Nikufra CRM", button: "Entrar com segurança" };
    case "recovery": return { subject: "Recuperar acesso ao Nikufra CRM", heading: "Recuperar acesso", button: "Continuar" };
    case "signup": return { subject: "Confirmar conta Nikufra CRM", heading: "Confirmar a tua conta", button: "Confirmar conta" };
    case "email_change":
    case "email_change_current":
    case "email_change_new": return { subject: "Confirmar alteração de email", heading: "Confirmar alteração de email", button: "Confirmar email" };
    default: return { subject: "Código de segurança Nikufra CRM", heading: "Código de segurança", button: "Continuar" };
  }
}

function verificationLink(action: string, tokenHash: string, redirectTo: string) {
  const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL");
  if (!publicUrl) throw new Error("SUPABASE_PUBLIC_URL não está configurado");
  const base = new URL(publicUrl);
  const loopback = base.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if (base.protocol !== "https:" && !loopback) throw new Error("SUPABASE_PUBLIC_URL tem de usar HTTPS ou loopback local");
  const url = new URL("/auth/v1/verify", base);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", action);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function linkedEmail(recipient: string, action: string, tokenHash: string, redirectTo: string): OutgoingEmail {
  if (!validEmail(recipient) || !tokenHash || !LINK_ACTIONS.has(action)) throw new Error("Payload de email inválido");
  const copy = actionCopy(action);
  const link = verificationLink(action, tokenHash, redirectTo);
  const text = `${copy.heading}\n\nAbre este link seguro (válido por tempo limitado):\n${link}\n\nSe não pediste esta ação, ignora este email.`;
  const html = `<!doctype html><html lang="pt"><body style="margin:0;background:#0b0d10;color:#f7f7f7;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:48px 24px"><div style="font-size:13px;letter-spacing:.12em;color:#8fa8c8;text-transform:uppercase">Nikufra CRM</div><h1 style="font-size:28px;line-height:1.2;margin:24px 0 12px">${escapeHtml(copy.heading)}</h1><p style="color:#bbc2cc;line-height:1.6">Usa o botão abaixo para continuar. Este acesso é pessoal e válido por tempo limitado.</p><p style="margin:32px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2878ff;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">${escapeHtml(copy.button)}</a></p><p style="font-size:13px;color:#7f8792;line-height:1.5">Se não pediste esta ação, ignora este email.</p></div></body></html>`;
  return { recipient, action, tokenHash, subject: copy.subject, text, html };
}

function codeEmail(recipient: string, action: string, token: string): OutgoingEmail {
  if (!validEmail(recipient) || !token) throw new Error("Payload de código inválido");
  const copy = actionCopy(action);
  const safeToken = escapeHtml(token);
  return {
    recipient,
    action,
    tokenHash: token,
    subject: copy.subject,
    text: `${copy.heading}\n\nCódigo: ${token}\n\nSe não pediste esta ação, ignora este email.`,
    html: `<!doctype html><html lang="pt"><body style="font-family:Arial,sans-serif"><h1>${escapeHtml(copy.heading)}</h1><p>O teu código é:</p><p style="font-size:28px;font-weight:700;letter-spacing:.12em">${safeToken}</p><p>Se não pediste esta ação, ignora este email.</p></body></html>`,
  };
}

function notificationEmail(recipient: string, action: string, data: EmailData): OutgoingEmail {
  if (!validEmail(recipient)) throw new Error("Destinatário inválido");
  const messages: Record<string, string> = {
    password_changed_notification: "A palavra-passe da tua conta foi alterada.",
    email_changed_notification: `O email da tua conta foi alterado${data.old_email ? ` a partir de ${data.old_email}` : ""}.`,
    phone_changed_notification: "O número de telefone da tua conta foi alterado.",
    identity_linked_notification: `Foi ligada uma nova identidade${data.provider ? ` (${data.provider})` : ""} à tua conta.`,
    identity_unlinked_notification: `Foi removida uma identidade${data.provider ? ` (${data.provider})` : ""} da tua conta.`,
    mfa_factor_enrolled_notification: `Foi adicionado um fator de autenticação${data.factor_type ? ` (${data.factor_type})` : ""}.`,
    mfa_factor_unenrolled_notification: `Foi removido um fator de autenticação${data.factor_type ? ` (${data.factor_type})` : ""}.`,
  };
  const message = messages[action] ?? "Foi efetuada uma alteração de segurança na tua conta.";
  return { recipient, action, tokenHash: action, subject: "Alteração de segurança no Nikufra CRM", text: `${message}\n\nSe não reconheces esta ação, contacta de imediato o administrador.`, html: `<h1>Alteração de segurança</h1><p>${escapeHtml(message)}</p><p>Se não reconheces esta ação, contacta de imediato o administrador.</p>` };
}

function emailsForPayload(payload: HookPayload) {
  const { user, email_data: data } = payload;
  const action = String(data.email_action_type ?? "");
  const redirectTo = String(data.redirect_to ?? "");

  if (action === "email_change") {
    const emails: OutgoingEmail[] = [];
    if (validEmail(user.email) && data.token_hash_new) emails.push(linkedEmail(user.email, action, data.token_hash_new, redirectTo));
    if (validEmail(user.new_email) && data.token_hash) emails.push(linkedEmail(user.new_email, action, data.token_hash, redirectTo));
    if (emails.length) return emails;
  }
  if (LINK_ACTIONS.has(action)) return [linkedEmail(String(user.email ?? ""), action, String(data.token_hash ?? ""), redirectTo)];
  if (action === "email" || action === "reauthentication") return [codeEmail(String(user.email ?? ""), action, String(data.token ?? ""))];
  return [notificationEmail(String(user.email ?? ""), action, data)];
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function mimeMessage(sender: string, email: OutgoingEmail, deliveryKey: string) {
  const boundary = `nikufra-${deliveryKey.slice(0, 24)}`;
  const subject = bytesToBase64(new TextEncoder().encode(email.subject));
  const mime = [
    `From: Nikufra CRM <${sender}>`,
    `To: ${email.recipient}`,
    `Subject: =?UTF-8?B?${subject}?=`,
    `Message-ID: <${deliveryKey}@crm.nikufra.ai>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return bytesToBase64Url(new TextEncoder().encode(mime));
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function gmailSender() {
  const admin = adminClient();
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id,email").eq("role", "admin").eq("ativo", true);
  if (profileError || !profiles?.length) throw new Error("Não existe administrador ativo para enviar emails");
  const { data: token, error: tokenError } = await admin.from("google_tokens").select("user_id,refresh_token_encrypted,updated_at").in("user_id", profiles.map((profile) => profile.id)).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (tokenError || !token) throw new Error("Liga a conta Gmail de um administrador antes de enviar convites");
  const sender = profiles.find((profile) => profile.id === token.user_id)?.email;
  if (!validEmail(sender)) throw new Error("Conta Gmail remetente inválida");
  return { admin, sender, accessToken: await gmailAccessToken(await decryptToken(token.refresh_token_encrypted)) };
}

async function reserveDelivery(admin: ReturnType<typeof adminClient>, email: OutgoingEmail) {
  const recipientHash = await sha256(email.recipient.toLowerCase());
  const deliveryKey = await sha256(`${email.action}\n${recipientHash}\n${email.tokenHash}`);
  const { data, error } = await admin.from("auth_email_deliveries").insert({ delivery_key: deliveryKey, recipient_hash: recipientHash, action: email.action }).select("id").single();
  if (!error && data) return { id: data.id as string, deliveryKey, send: true };
  if (error?.code !== "23505") throw error;
  const { data: existing, error: existingError } = await admin.from("auth_email_deliveries").select("id,status,attempts,updated_at").eq("delivery_key", deliveryKey).single();
  if (existingError || !existing) throw existingError ?? new Error("Falha ao validar entrega existente");
  if (existing.status === "sent") return { id: existing.id as string, deliveryKey, send: false };
  const stale = Date.now() - new Date(existing.updated_at).getTime() > 120_000;
  if (existing.status === "sending" && !stale) return { id: existing.id as string, deliveryKey, send: false };
  const { error: retryError } = await admin.from("auth_email_deliveries").update({ status: "sending", attempts: existing.attempts + 1, last_error: null }).eq("id", existing.id);
  if (retryError) throw retryError;
  return { id: existing.id as string, deliveryKey, send: true };
}

async function sendEmail(sender: Awaited<ReturnType<typeof gmailSender>>, email: OutgoingEmail) {
  const reservation = await reserveDelivery(sender.admin, email);
  if (!reservation.send) return;
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${sender.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: mimeMessage(sender.sender, email, reservation.deliveryKey) }),
    });
    if (!response.ok) throw new Error(`Gmail API recusou a mensagem (${response.status})`);
    const result = await response.json() as { id?: string };
    const { error } = await sender.admin.from("auth_email_deliveries").update({ status: "sent", provider_message_id: result.id ?? null, last_error: null }).eq("id", reservation.id);
    // The provider already accepted the message. Do not ask GoTrue to retry
    // (and risk a duplicate) solely because the audit update failed.
    if (error) console.error("Email enviado, mas o registo idempotente não foi atualizado", error);
  } catch (error) {
    await sender.admin.from("auth_email_deliveries").update({ status: "failed", last_error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida" }).eq("id", reservation.id);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
  const configuredSecret = Deno.env.get("AUTH_EMAIL_HOOK_SECRET") ?? "";
  if (!configuredSecret.startsWith("v1,whsec_")) return Response.json({ error: "Hook não configurado" }, { status: 503 });

  const body = await request.text();
  let payload: HookPayload;
  try {
    const webhook = new Webhook(configuredSecret.replace(/^v1,whsec_/, ""));
    payload = webhook.verify(body, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    return Response.json({ error: { http_code: 401, message: "Assinatura inválida" } }, { status: 401 });
  }

  try {
    const emails = emailsForPayload(payload);
    const sender = await gmailSender();
    for (const email of emails) await sendEmail(sender, email);
    return Response.json({});
  } catch (error) {
    console.error("Falha no envio de email de autenticação", error);
    return Response.json({ error: { http_code: 503, message: "O email não pôde ser enviado" } }, { status: 503, headers: { "retry-after": "1" } });
  }
});
