import { activeUser, adminClient, corsHeaders, decryptToken, gmailAccessToken } from "../_shared/security.ts";

type GmailHeader = { name: string; value: string };
type TokenRow = { user_id: string; refresh_token_encrypted: string; history_id: string | null; backfill_page_token: string | null; backfill_complete: boolean; messages_synced: number; contacts_created: number; profiles: { email?: string } | Array<{ email?: string }> | null };
const publicEmailDomains = new Set(["gmail.com", "hotmail.com", "hotmail.pt", "outlook.com", "outlook.pt", "icloud.com", "me.com", "live.com", "live.pt", "yahoo.com", "yahoo.es", "sapo.pt"]);

function headerValue(headers: GmailHeader[], name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function addresses(value: string) {
  return [...new Set([...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase()))];
}

function normalized(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function titleCase(value: string) {
  return value.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Contacto";
}

function contactName(header: string, email: string) {
  const beforeAddress = header.split("<")[0]?.replaceAll('"', "").trim();
  return beforeAddress && !beforeAddress.includes("@") ? beforeAddress.slice(0, 240) : titleCase(email.split("@")[0]);
}

function isAutomated(headers: GmailHeader[], email: string) {
  const local = email.split("@")[0] ?? "";
  const automatic = headerValue(headers, "Auto-Submitted").toLowerCase();
  const precedence = headerValue(headers, "Precedence").toLowerCase();
  return /(^|[._-])(no-?reply|noreply|mailer-daemon|notifications?|alerts?|newsletter)([._+-]|$)/i.test(local)
    || (automatic && automatic !== "no")
    || ["bulk", "list", "junk"].includes(precedence)
    || Boolean(headerValue(headers, "List-Unsubscribe"));
}

function meetingSignal(subject: string, snippet: string) {
  const text = normalized(`${subject} ${snippet}`);
  return /(reuniao|meeting|calendar|calendario|convite|invite|teams|googlemeet|zoom|agendamento|schedule|disponibilidade)/.test(text);
}

async function gmailJson(url: URL | string, accessToken: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Gmail API falhou (${response.status})`);
  return response.json();
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await mapper(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const serviceRequest = request.headers.get("authorization") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  let requestedUserId: string | null = null;
  try { if (!serviceRequest) requestedUserId = (await activeUser(request)).user.id; }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Sessão inválida" }, { status: 401, headers: corsHeaders }); }

  const admin = adminClient();
  let tokenQuery = admin.from("google_tokens").select("user_id,refresh_token_encrypted,history_id,backfill_page_token,backfill_complete,messages_synced,contacts_created,profiles(email)");
  if (requestedUserId) tokenQuery = tokenQuery.eq("user_id", requestedUserId);
  const { data: tokenRows, error: tokenError } = await tokenQuery;
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500, headers: corsHeaders });
  let totalSynced = 0; let totalContactsCreated = 0;

  for (const tokenRow of (tokenRows ?? []) as TokenRow[]) {
    let batchSynced = 0; let batchContactsCreated = 0;
    try {
      await admin.from("google_tokens").update({ sync_error: null, ...(!tokenRow.backfill_complete ? { backfill_started_at: new Date().toISOString() } : {}) }).eq("user_id", tokenRow.user_id);
      const accessToken = await gmailAccessToken(await decryptToken(tokenRow.refresh_token_encrypted));
      const profile = Array.isArray(tokenRow.profiles) ? tokenRow.profiles[0] : tokenRow.profiles;
      const ownEmail = profile?.email?.toLowerCase() ?? "";
      const ownDomain = ownEmail.split("@")[1] ?? "nikufra.ai";
      const ownBusinessDomain = publicEmailDomains.has(ownDomain) ? null : ownDomain;
      const messageIds = new Set<string>();
      let newestHistory = tokenRow.history_id;
      let nextBackfillPage: string | null = tokenRow.backfill_page_token;
      let backfillComplete = tokenRow.backfill_complete;

      if (!backfillComplete) {
        if (!newestHistory) {
          const gmailProfile = await gmailJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
          newestHistory = gmailProfile.historyId ?? null;
        }
        const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        listUrl.searchParams.set("maxResults", "100");
        if (nextBackfillPage) listUrl.searchParams.set("pageToken", nextBackfillPage);
        const payload = await gmailJson(listUrl, accessToken);
        for (const message of payload.messages ?? []) messageIds.add(message.id);
        nextBackfillPage = payload.nextPageToken ?? null;
        backfillComplete = !nextBackfillPage;
      } else if (newestHistory) {
        let pageToken = "";
        try {
          do {
            const historyUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
            historyUrl.searchParams.set("startHistoryId", newestHistory);
            historyUrl.searchParams.set("historyTypes", "messageAdded");
            historyUrl.searchParams.set("maxResults", "100");
            if (pageToken) historyUrl.searchParams.set("pageToken", pageToken);
            const payload = await gmailJson(historyUrl, accessToken);
            for (const history of payload.history ?? []) for (const added of history.messagesAdded ?? []) messageIds.add(added.message.id);
            newestHistory = payload.historyId ?? newestHistory;
            pageToken = payload.nextPageToken ?? "";
          } while (pageToken);
        } catch {
          backfillComplete = false; nextBackfillPage = null;
        }
      }

      const fetchedMessages = await mapLimit([...messageIds], 10, async (messageId) => {
        const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
        messageUrl.searchParams.set("format", "metadata");
        for (const name of ["From", "To", "Cc", "Subject", "Date", "List-Unsubscribe", "Auto-Submitted", "Precedence"]) messageUrl.searchParams.append("metadataHeaders", name);
        try { return await gmailJson(messageUrl, accessToken) as Record<string, any>; } catch { return null; }
      });
      for (const message of fetchedMessages) {
        if (!message) continue;
        const headers = (message.payload?.headers ?? []) as GmailHeader[];
        const from = addresses(headerValue(headers, "From"));
        const recipients = addresses(`${headerValue(headers, "To")},${headerValue(headers, "Cc")}`);
        const sent = from.includes(ownEmail) || (message.labelIds ?? []).includes("SENT");
        const externalEmails = [...new Set((sent ? recipients : from).filter((email) => email !== ownEmail && (!ownBusinessDomain || email.split("@")[1] !== ownBusinessDomain) && !isAutomated(headers, email)))];
        if (!externalEmails.length) continue;
        const date = new Date(Number(message.internalDate)).toISOString();
        const subject = headerValue(headers, "Subject") || "Email sem assunto";
        const inferredMeeting = meetingSignal(subject, String(message.snippet ?? ""));

        for (const externalEmail of externalEmails) {
          let { data: contact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado").eq("email", externalEmail).maybeSingle();
          if (!contact) {
            const domain = externalEmail.split("@")[1];
            const isPublicDomain = publicEmailDomains.has(domain);
            const displayName = contactName(headerValue(headers, sent ? "To" : "From"), externalEmail);
            let company: { id: string; nome: string } | null = null;
            if (!isPublicDomain) ({ data: company } = await admin.from("empresas").select("id,nome").eq("email_domain", domain).limit(1).maybeSingle());
            if (!company) {
              const companyName = isPublicDomain ? `${displayName} (particular)` : titleCase(domain.split(".")[0]);
              const { data, error } = await admin.from("empresas").insert({ nome: companyName, nome_normalizado: normalized(companyName), email_domain: isPublicDomain ? null : domain, vertical: "outro", pais: "PT", origem: "outbound_email", notas: "Criada automaticamente pela sincronização Gmail" }).select("id,nome").single();
              if (error) throw error; company = data;
            }
            const { data, error } = await admin.from("contactos").insert({ empresa_id: company.id, nome: displayName, email: externalEmail, principal: false, estado: "contactado", notas: "Criado automaticamente pelo Gmail" }).select("id,empresa_id,email,nome,estado").single();
            if (error) {
              const { data: racedContact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado").eq("email", externalEmail).maybeSingle();
              if (!racedContact) throw error;
              contact = racedContact;
            } else { contact = data; batchContactsCreated += 1; }
          }
          if (contact.estado === "nao_contactado") { await admin.from("contactos").update({ estado: "contactado" }).eq("id", contact.id); contact.estado = "contactado"; }
          let { data: opportunity } = await admin.from("oportunidades").select("id,data_primeiro_contacto").eq("empresa_id", contact.empresa_id).eq("arquivado", false).order("created_at").limit(1).maybeSingle();
          if (!opportunity) {
            const { data, error } = await admin.from("oportunidades").insert({ empresa_id: contact.empresa_id, contacto_principal_id: contact.id, owner_id: tokenRow.user_id, titulo: "Relação comercial", estado: "contactado", tipo: "consultoria", valor_estimado: 0, data_primeiro_contacto: date.slice(0, 10), import_key: `gmail:${contact.empresa_id}` }).select("id,data_primeiro_contacto").single();
            if (error) throw error; opportunity = data;
          } else if (!opportunity.data_primeiro_contacto || date.slice(0, 10) < opportunity.data_primeiro_contacto) {
            await admin.from("oportunidades").update({ data_primeiro_contacto: date.slice(0, 10) }).eq("id", opportunity.id);
          }
          const { error: activityError } = await admin.from("atividades").upsert({ oportunidade_id: opportunity.id, empresa_id: contact.empresa_id, contacto_id: contact.id, user_id: tokenRow.user_id, tipo: sent ? "email_enviado" : "email_recebido", direcao: sent ? "enviado" : "recebido", data, descricao: subject.slice(0, 500), message_id: message.id, thread_id: message.threadId, assunto: subject.slice(0, 500), snippet: String(message.snippet ?? "").slice(0, 240), reuniao_inferida: inferredMeeting }, { onConflict: "message_id,contacto_id", ignoreDuplicates: true });
          if (!activityError) batchSynced += 1;
        }
      }
      const { count: exactMessageCount } = await admin.from("atividades").select("id", { count: "exact", head: true }).eq("user_id", tokenRow.user_id).not("message_id", "is", null);
      const update = { history_id: newestHistory, backfill_page_token: nextBackfillPage, backfill_complete: backfillComplete, last_sync_at: new Date().toISOString(), messages_synced: exactMessageCount ?? Number(tokenRow.messages_synced || 0), contacts_created: Number(tokenRow.contacts_created || 0) + batchContactsCreated, sync_error: null };
      await admin.from("google_tokens").update(update).eq("user_id", tokenRow.user_id);
      totalSynced += batchSynced; totalContactsCreated += batchContactsCreated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("google_tokens").update({ sync_error: message.slice(0, 1000), last_sync_at: new Date().toISOString() }).eq("user_id", tokenRow.user_id);
      console.error(`Sync Gmail falhou para ${tokenRow.user_id}`, error);
    }
  }
  return Response.json({ synced: totalSynced, contactsCreated: totalContactsCreated, accounts: tokenRows?.length ?? 0 }, { headers: corsHeaders });
});
