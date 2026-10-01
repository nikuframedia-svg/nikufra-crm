import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { buildMime, htmlToText } from "./mime.js";
import { refreshOAuthCredential } from "./oauth.js";
import { resolveMailEndpoint } from "./transport-security.js";
import type { DeliveryEnvelope, InboundProviderMessage, OAuthCredential, Provider, ProviderCredential, ProviderReceipt, SmtpCredential } from "./types.js";

export interface ProviderSession {
  provider: Provider;
  credentials: ProviderCredential;
  persist: (credentials: ProviderCredential) => Promise<void>;
}

export async function revokeProviderAuthorization(session: ProviderSession) {
  if (session.provider !== "google" || session.credentials.kind !== "oauth") {
    return { supported: false, revoked: false } as const;
  }
  const token = session.credentials.refreshToken || session.credentials.accessToken;
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // Google uses 400 for an already invalid/revoked token. Local deletion may
  // proceed because there is no remaining usable authorization to preserve.
  if (response.ok || response.status === 400) return { supported: true, revoked: true } as const;
  throw new HttpError(502, "oauth_revoke_failed", "O provider não confirmou a revogação OAuth.", { providerStatus: response.status });
}

async function providerJson(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; }
    catch { payload = { invalidJson: true, bodyPreview: text.slice(0, 500) }; }
  }
  if (!response.ok) throw new HttpError(502, "provider_error", `Provider respondeu ${response.status}.`, { providerStatus: response.status });
  if (text && typeof payload === "object" && payload !== null && "invalidJson" in payload) {
    throw new HttpError(502, "provider_invalid_response", "O provider devolveu uma resposta inválida.");
  }
  return payload;
}

/**
 * Authentication failures require an explicit mailbox reconnect. Keeping this
 * decision in one place prevents inbound and outbound workers from repeatedly
 * hammering a revoked account while still treating transient provider errors as
 * reconcilable delivery failures.
 */
export function isProviderAuthorizationFailure(error: unknown) {
  if (!(error instanceof HttpError)) return false;
  if (error.code === "oauth_token_rejected" || error.code === "oauth_refresh_missing") return true;
  if (error.code !== "provider_error" || typeof error.details !== "object" || error.details === null) return false;
  const status = "providerStatus" in error.details ? Number(error.details.providerStatus) : Number.NaN;
  return status === 401 || status === 403;
}

async function freshOAuth(session: ProviderSession) {
  if (session.provider === "smtp" || session.credentials.kind !== "oauth") throw new Error("Credencial OAuth incompatível.");
  const fresh = await refreshOAuthCredential(session.provider, session.credentials);
  if (fresh !== session.credentials) await session.persist(fresh);
  return fresh;
}

export async function testProvider(session: ProviderSession) {
  if (session.provider === "google") {
    const credential = await freshOAuth(session);
    await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", credential.accessToken);
    return { send: true, inbound: true, detail: "Gmail API autenticada." };
  }
  if (session.provider === "microsoft") {
    if (!config.microsoft.enabled) throw new HttpError(503, "provider_not_certified", "Microsoft está isolado e não pode ser ativado antes de concluir os testes específicos do provider.");
    const credential = await freshOAuth(session);
    await providerJson("https://graph.microsoft.com/v1.0/me?$select=id", credential.accessToken);
    return { send: true, inbound: true, detail: "Microsoft Graph autenticado." };
  }
  if (!config.smtpEnabled || session.credentials.kind !== "smtp") throw new HttpError(503, "provider_not_certified", "SMTP/IMAP está isolado e não pode ser ativado antes de concluir os testes específicos do provider.");
  const transport = await smtpTransport(session.credentials);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
  return { send: true, inbound: Boolean(session.credentials.imap), detail: "SMTP autenticado." };
}

async function smtpTransport(credential: SmtpCredential) {
  const endpoint = await resolveMailEndpoint(credential.smtp.host, credential.smtp.rejectUnauthorized);
  return nodemailer.createTransport({
    host: endpoint.address,
    servername: endpoint.servername,
    port: credential.smtp.port,
    secure: credential.smtp.secure,
    requireTLS: !credential.smtp.secure,
    auth: credential.smtp.username ? { user: credential.smtp.username, pass: credential.smtp.password } : undefined,
    tls: { rejectUnauthorized: true, servername: endpoint.servername },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  } as SMTPTransport.Options);
}

export async function prepareProviderSession(session: ProviderSession): Promise<ProviderSession> {
  if (session.provider === "google" || session.provider === "microsoft") {
    if (session.credentials.kind !== "oauth") {
      throw new HttpError(409, "oauth_credential_required", "Este provider exige credenciais OAuth.");
    }
    const credentials = await freshOAuth(session);
    return { ...session, credentials };
  }
  return session;
}

export async function sendProviderMessage(
  session: ProviderSession,
  envelope: DeliveryEnvelope,
  options: { credentialsPrepared?: boolean } = {},
): Promise<ProviderReceipt> {
  const mime = buildMime({
    idempotencyKey: envelope.idempotencyKey,
    senderName: envelope.senderName,
    from: envelope.fromEmail,
    to: envelope.to,
    subject: envelope.subject,
    text: envelope.text,
    unsubscribeUrl: envelope.unsubscribeUrl,
    inReplyTo: envelope.inReplyTo,
    references: envelope.references,
  });
  if (session.provider === "google") {
    const credential = options.credentialsPrepared && session.credentials.kind === "oauth"
      ? session.credentials
      : await freshOAuth(session);
    const payload = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", credential.accessToken, {
      method: "POST",
      // This is the only network operation under the shared DB permit. Keep it
      // strictly below the 20s writer lock timeout so opt-out/kill writers can
      // wait for a permitted call instead of timing out and rolling back.
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ raw: Buffer.from(mime.raw).toString("base64url"), threadId: envelope.providerThreadId || undefined }),
    }) as { id?: string; threadId?: string };
    if (!payload.id) throw new HttpError(502, "provider_receipt_missing", "Gmail não devolveu o ID da mensagem.");
    return { providerMessageId: payload.id, providerThreadId: payload.threadId ?? null, internetMessageId: mime.internetMessageId, acceptedAt: new Date().toISOString() };
  }
  if (session.provider === "microsoft") {
    if (!config.microsoft.enabled) throw new HttpError(503, "provider_not_certified", "Microsoft ainda não é um provider certificado para envio.");
    const credential = options.credentialsPrepared && session.credentials.kind === "oauth"
      ? session.credentials
      : await freshOAuth(session);
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${credential.accessToken}`, "content-type": "text/plain" },
      body: Buffer.from(mime.raw).toString("base64"),
    });
    if (!response.ok) throw new HttpError(502, "provider_error", `Microsoft recusou o envio (${response.status}).`);
    return { providerMessageId: mime.internetMessageId, providerThreadId: envelope.providerThreadId, internetMessageId: mime.internetMessageId, acceptedAt: new Date().toISOString() };
  }
  if (!config.smtpEnabled || session.credentials.kind !== "smtp") throw new HttpError(503, "provider_not_certified", "SMTP ainda não é um provider certificado para envio.");
  const transport = await smtpTransport(session.credentials);
  const result = await transport.sendMail({ envelope: { from: envelope.fromEmail, to: [envelope.to] }, raw: Buffer.from(mime.raw) }).finally(() => transport.close());
  return { providerMessageId: result.messageId || mime.internetMessageId, providerThreadId: null, internetMessageId: mime.internetMessageId, acceptedAt: new Date().toISOString() };
}

export async function reconcileProviderMessage(session: ProviderSession, internetMessageId: string): Promise<ProviderReceipt | null> {
  if (session.provider === "google") {
    const credential = await freshOAuth(session);
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", `in:sent rfc822msgid:${internetMessageId}`);
    url.searchParams.set("maxResults", "2");
    const payload = await providerJson(url.toString(), credential.accessToken) as { messages?: { id: string; threadId?: string }[] };
    const match = payload.messages?.[0];
    if (!match) return null;
    return { providerMessageId: match.id, providerThreadId: match.threadId ?? null, internetMessageId, acceptedAt: new Date().toISOString() };
  }
  // Providers that are not active in the first rollout are deliberately never
  // retried automatically after an ambiguous result.
  return null;
}

function gmailHeaders(payload: { headers?: { name: string; value: string }[] }) {
  return new Map((payload.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
}

function gmailText(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string {
  if (["text/plain", "message/feedback-report", "message/delivery-status", "text/rfc822-headers"].includes(part.mimeType ?? "") && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  if (part.mimeType?.toLowerCase().startsWith("multipart/report")) {
    return (part.parts ?? []).map((child) => gmailText(child as typeof part)).filter(Boolean).join("\n\n");
  }
  for (const child of part.parts ?? []) {
    const value = gmailText(child as typeof part);
    if (value) return value;
  }
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(Buffer.from(part.body.data, "base64url").toString("utf8"));
  return "";
}

export async function listGmailMessageReferences(accessToken: string, since: Date, maximum = 5_000) {
  const output: { id: string; threadId: string }[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("labelIds", "INBOX");
    url.searchParams.set("q", `after:${Math.floor(since.getTime() / 1000)}`);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await providerJson(url.toString(), accessToken) as { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
    const messages = page.messages ?? [];
    if (output.length + messages.length > maximum) throw new HttpError(409, "gmail_sync_limit", `A caixa de entrada excede o limite seguro de ${maximum} mensagens por sincronização.`);
    output.push(...messages);
    const next = page.nextPageToken?.trim() || null;
    if (next && output.length >= maximum) throw new HttpError(409, "gmail_sync_limit", `A caixa de entrada excede o limite seguro de ${maximum} mensagens por sincronização.`);
    if (next && seenPageTokens.has(next)) throw new HttpError(502, "gmail_pagination_loop", "O Gmail devolveu paginação inconsistente.");
    if (next) seenPageTokens.add(next);
    pageToken = next;
  } while (pageToken);
  return output;
}

export async function listInboundMessages(session: ProviderSession, since: Date): Promise<InboundProviderMessage[]> {
  if (session.provider === "google") {
    const credential = await freshOAuth(session);
    const refs = await listGmailMessageReferences(credential.accessToken, since);
    const output: InboundProviderMessage[] = [];
    for (let offset = 0; offset < refs.length; offset += 20) {
      output.push(...await Promise.all(refs.slice(offset, offset + 20).map(async (ref) => {
        const message = await providerJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`, credential.accessToken) as { id: string; threadId: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: unknown[] } };
        const headers = gmailHeaders(message.payload ?? {});
        return {
          providerMessageId: message.id,
          providerThreadId: message.threadId,
          internetMessageId: headers.get("message-id") ?? null,
          inReplyTo: headers.get("in-reply-to") ?? null,
          references: (headers.get("references") ?? "").split(/\s+/).filter(Boolean),
          from: headers.get("from") ?? "",
          subject: headers.get("subject") ?? "(sem assunto)",
          text: gmailText(message.payload ?? {}),
          receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
          autoSubmitted: headers.get("auto-submitted") ?? null,
          headers: Object.fromEntries(headers),
        };
      })));
    }
    return output;
  }
  if (session.provider === "microsoft") {
    if (!config.microsoft.enabled) throw new HttpError(503, "provider_not_certified", "Microsoft ainda não é um provider certificado para sincronização.");
    const credential = await freshOAuth(session);
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const payload = await providerJson(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$top=500`, credential.accessToken) as { value?: Array<Record<string, unknown>> };
    return (payload.value ?? []).map((raw) => {
      const from = raw.from as { emailAddress?: { address?: string } } | undefined;
      const body = raw.body as { contentType?: string; content?: string } | undefined;
      return {
        providerMessageId: String(raw.id),
        providerThreadId: typeof raw.conversationId === "string" ? raw.conversationId : null,
        internetMessageId: typeof raw.internetMessageId === "string" ? raw.internetMessageId : null,
        inReplyTo: null,
        references: [],
        from: from?.emailAddress?.address ?? "",
        subject: typeof raw.subject === "string" ? raw.subject : "(sem assunto)",
        text: body?.contentType?.toLowerCase() === "html" ? htmlToText(body.content ?? "") : body?.content ?? "",
        receivedAt: typeof raw.receivedDateTime === "string" ? raw.receivedDateTime : new Date().toISOString(),
        autoSubmitted: null,
        headers: {},
      };
    });
  }
  if (!config.smtpEnabled || session.credentials.kind !== "smtp") throw new HttpError(503, "provider_not_certified", "IMAP ainda não é um provider certificado para sincronização.");
  if (!session.credentials.imap) return [];
  const credential = session.credentials.imap;
  const endpoint = await resolveMailEndpoint(credential.host, credential.rejectUnauthorized);
  const client = new ImapFlow({ host: endpoint.address, ...(endpoint.servername ? { servername: endpoint.servername } : {}), port: credential.port, secure: credential.secure, doSTARTTLS: !credential.secure, connectionTimeout: 20_000, auth: { user: credential.username, pass: credential.password }, tls: { rejectUnauthorized: true }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const output: InboundProviderMessage[] = [];
    for await (const item of client.fetch({ since }, { uid: true, source: true })) {
      if (!item.source) continue;
      const parsed = await simpleParser(item.source);
      output.push({
        providerMessageId: `imap:${item.uid}`,
        providerThreadId: null,
        internetMessageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
        from: parsed.from?.value[0]?.address ?? "",
        subject: parsed.subject ?? "(sem assunto)",
        text: parsed.text ?? htmlToText(typeof parsed.html === "string" ? parsed.html : ""),
        receivedAt: (parsed.date ?? new Date()).toISOString(),
        autoSubmitted: typeof parsed.headers.get("auto-submitted") === "string" ? String(parsed.headers.get("auto-submitted")) : null,
        headers: Object.fromEntries([...parsed.headers.entries()].flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])),
      });
      if (output.length >= 5_000) throw new Error("A caixa IMAP excede o limite seguro por sincronização.");
    }
    return output;
  } finally {
    lock.release();
    await client.logout();
  }
}
