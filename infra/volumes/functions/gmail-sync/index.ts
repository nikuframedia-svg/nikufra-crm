import { activeUser, adminClient, corsHeaders, decryptToken, gmailAccessToken } from "../_shared/security.ts";

type GmailHeader = { name: string; value: string };
type TokenRow = {
  user_id: string;
  refresh_token_encrypted: string;
  history_id: string | null;
  backfill_page_token: string | null;
  backfill_complete: boolean;
  messages_synced: number;
  contacts_created: number;
  people_sync_token: string | null;
  other_contacts_sync_token: string | null;
  calendar_sync_token: string | null;
  people_contacts_synced: number;
  calendar_events_synced: number;
  import_confirmed_at: string;
  profiles: { email?: string } | Array<{ email?: string }> | null;
};
type ContactSeed = {
  userId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  organization?: string | null;
  googleResourceName?: string | null;
  contacted: boolean;
  firstContact?: string | null;
  source: "Gmail" | "Google Contacts" | "Google Calendar";
};

const publicEmailDomains = new Set(["gmail.com", "hotmail.com", "hotmail.pt", "outlook.com", "outlook.pt", "icloud.com", "me.com", "live.com", "live.pt", "yahoo.com", "yahoo.es", "sapo.pt"]);
const stageRank: Record<string, number> = { nao_contactado: 0, contactado: 1, reuniao_marcada: 2, reuniao_feita: 3, piloto: 4, proposta: 5, cliente: 6, perdido: -1, adiado: -1 };

class GoogleApiError extends Error {
  constructor(public status: number, api: string) { super(`${api} falhou (${status})`); }
}

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

function contactDisplayName(name: string, email?: string | null) {
  const cleaned = clean(name, 240);
  if (cleaned && !cleaned.includes("@")) return cleaned;
  return email ? titleCase(email.split("@")[0]) : "Contacto Google";
}

function contactName(header: string, email: string) {
  const beforeAddress = header.split("<")[0]?.replaceAll('"', "").trim();
  return beforeAddress && !beforeAddress.includes("@") ? beforeAddress.slice(0, 240) : titleCase(email.split("@")[0]);
}

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function businessDomain(email?: string | null) {
  const domain = email?.split("@")[1]?.toLowerCase() ?? "";
  return domain && !publicEmailDomains.has(domain) ? domain : null;
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

async function googleJson(url: URL | string, accessToken: string, api = "Google API") {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new GoogleApiError(response.status, api);
  return response.json();
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; results[index] = await mapper(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function ensureContact(admin: ReturnType<typeof adminClient>, seed: ContactSeed) {
  const email = clean(seed.email, 320).toLowerCase() || null;
  const resourceName = clean(seed.googleResourceName, 500) || null;
  const resolvedName = contactDisplayName(seed.name, email);
  if (email || resourceName) {
    // RGPD tombstones retain only keyed digests. The service-role-only RPC
    // performs the comparison inside Postgres so neither the key nor digest is
    // exposed to this Edge Function. Fail closed if the check cannot run.
    const { data: suppressed, error: suppressionError } = await admin.rpc(
      "is_contact_import_suppressed",
      { p_email: email, p_google_resource_name: resourceName },
    );
    if (suppressionError) throw suppressionError;
    if (suppressed === true) return null;
  }
  let contact = null;
  if (email) ({ data: contact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado,data_reuniao,google_resource_name").eq("email", email).maybeSingle());
  if (!contact && resourceName) ({ data: contact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado,data_reuniao,google_resource_name").eq("google_resource_name", resourceName).maybeSingle());
  let created = false;

  if (!contact) {
    const domain = businessDomain(email);
    const organization = clean(seed.organization, 240);
    let company = null;
    if (organization) ({ data: company } = await admin.from("empresas").select("id,nome").eq("nome_normalizado", normalized(organization)).limit(1).maybeSingle());
    if (!company && domain) ({ data: company } = await admin.from("empresas").select("id,nome").eq("email_domain", domain).limit(1).maybeSingle());
    if (!company) {
      const companyName = organization || (domain ? titleCase(domain.split(".")[0]) : `${resolvedName || "Contacto"} (particular)`);
      const { data, error } = await admin.from("empresas").insert({ nome: companyName, nome_normalizado: normalized(companyName), email_domain: domain, vertical: "outro", pais: "PT", origem: seed.source === "Gmail" ? "outbound_email" : "rede_pessoal", notas: `Criada automaticamente por ${seed.source}` }).select("id,nome").single();
      if (error) throw error; company = data;
    }
    const payload = { empresa_id: company.id, nome: resolvedName, cargo: clean(seed.role, 240) || null, email, telefone: clean(seed.phone, 80) || null, google_resource_name: resourceName, principal: false, estado: seed.contacted ? "contactado" : "nao_contactado", notas: `Criado automaticamente por ${seed.source}` };
    const { data, error } = await admin.from("contactos").insert(payload).select("id,empresa_id,email,nome,estado,data_reuniao,google_resource_name").single();
    if (error) {
      if (email) ({ data: contact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado,data_reuniao,google_resource_name").eq("email", email).maybeSingle());
      if (!contact && resourceName) ({ data: contact } = await admin.from("contactos").select("id,empresa_id,email,nome,estado,data_reuniao,google_resource_name").eq("google_resource_name", resourceName).maybeSingle());
      if (!contact) throw error;
    } else { contact = data; created = true; }
  } else {
    const changes: Record<string, unknown> = {};
    if (resourceName && !contact.google_resource_name) changes.google_resource_name = resourceName;
    if ((contact.nome.includes("@") || ["contacto", "contacto google"].includes(contact.nome.toLowerCase())) && resolvedName !== "Contacto Google") changes.nome = resolvedName;
    if (seed.contacted && contact.estado === "nao_contactado") { changes.estado = "contactado"; contact.estado = "contactado"; }
    if (clean(seed.phone, 80)) changes.telefone = clean(seed.phone, 80);
    if (clean(seed.role, 240)) changes.cargo = clean(seed.role, 240);
    if (Object.keys(changes).length) await admin.from("contactos").update(changes).eq("id", contact.id);
  }

  if (!contact) throw new Error("Não foi possível resolver o contacto Google");
  let { data: opportunity } = await admin.from("oportunidades").select("id,estado,data_primeiro_contacto,data_reuniao").eq("empresa_id", contact.empresa_id).eq("arquivado", false).order("created_at").limit(1).maybeSingle();
  if (!opportunity) {
    const state = seed.contacted ? "contactado" : "nao_contactado";
    const { data, error } = await admin.from("oportunidades").insert({ empresa_id: contact.empresa_id, contacto_principal_id: contact.id, owner_id: seed.userId, titulo: "Relação comercial", estado: state, tipo: "consultoria", valor_estimado: 0, data_primeiro_contacto: seed.firstContact || null, import_key: `${seed.source === "Gmail" ? "gmail" : "google"}:${contact.empresa_id}` }).select("id,estado,data_primeiro_contacto,data_reuniao").single();
    if (error) throw error; opportunity = data;
  } else if (seed.firstContact && (!opportunity.data_primeiro_contacto || seed.firstContact < opportunity.data_primeiro_contacto)) {
    await admin.from("oportunidades").update({ data_primeiro_contacto: seed.firstContact }).eq("id", opportunity.id);
    opportunity.data_primeiro_contacto = seed.firstContact;
  }
  return { contact, opportunity, created };
}

async function listPeople(accessToken: string, kind: "connections" | "other", syncToken: string | null) {
  async function load(token: string | null) {
    const people: Array<Record<string, any>> = []; let pageToken = ""; let nextSyncToken = token;
    do {
      const url = new URL(kind === "connections" ? "https://people.googleapis.com/v1/people/me/connections" : "https://people.googleapis.com/v1/otherContacts");
      url.searchParams.set(kind === "connections" ? "personFields" : "readMask", kind === "connections" ? "names,emailAddresses,phoneNumbers,organizations,metadata" : "names,emailAddresses,phoneNumbers,metadata");
      url.searchParams.set("pageSize", "1000");
      if (kind === "connections") url.searchParams.set("sources", "READ_SOURCE_TYPE_CONTACT");
      url.searchParams.set("requestSyncToken", "true");
      if (token) url.searchParams.set("syncToken", token);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await googleJson(url, accessToken, kind === "connections" ? "Google Contacts" : "Google Other Contacts");
      people.push(...(kind === "connections" ? payload.connections ?? [] : payload.otherContacts ?? []));
      pageToken = payload.nextPageToken ?? "";
      nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { people, nextSyncToken };
  }
  try { return await load(syncToken); }
  catch (error) { if (syncToken && error instanceof GoogleApiError && error.status === 400) return load(null); throw error; }
}

function personSeed(person: Record<string, any>, userId: string, source: "Google Contacts") {
  const primaryName = person.names?.find((item: Record<string, any>) => item.metadata?.primary) ?? person.names?.[0];
  const primaryEmail = person.emailAddresses?.find((item: Record<string, any>) => item.metadata?.primary) ?? person.emailAddresses?.[0];
  const primaryPhone = person.phoneNumbers?.find((item: Record<string, any>) => item.metadata?.primary) ?? person.phoneNumbers?.[0];
  const primaryOrganization = person.organizations?.find((item: Record<string, any>) => item.current) ?? person.organizations?.[0];
  return {
    userId,
    name: contactDisplayName(clean(primaryName?.displayName, 240), clean(primaryEmail?.value, 320) || null),
    email: clean(primaryEmail?.value, 320) || null,
    phone: clean(primaryPhone?.value, 80) || null,
    role: clean(primaryOrganization?.title, 240) || null,
    organization: clean(primaryOrganization?.name, 240) || null,
    googleResourceName: clean(person.resourceName, 500) || null,
    contacted: false,
    source,
  } satisfies ContactSeed;
}

async function listCalendarEvents(accessToken: string, syncToken: string | null) {
  async function load(token: string | null) {
    const events: Array<Record<string, any>> = []; let pageToken = ""; let nextSyncToken = token;
    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("showDeleted", "true");
      if (token) url.searchParams.set("syncToken", token);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await googleJson(url, accessToken, "Google Calendar");
      events.push(...(payload.items ?? []));
      pageToken = payload.nextPageToken ?? "";
      nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { events, nextSyncToken };
  }
  try { return await load(syncToken); }
  catch (error) { if (syncToken && error instanceof GoogleApiError && error.status === 410) return load(null); throw error; }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const serviceRequest = request.headers.get("authorization") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  let requestedUserId: string | null = null;
  try { if (!serviceRequest) requestedUserId = (await activeUser(request)).user.id; }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Sessão inválida" }, { status: 401, headers: corsHeaders }); }

  const admin = adminClient();
  let tokenQuery = admin.from("google_tokens").select("user_id,refresh_token_encrypted,history_id,backfill_page_token,backfill_complete,messages_synced,contacts_created,people_sync_token,other_contacts_sync_token,calendar_sync_token,people_contacts_synced,calendar_events_synced,import_confirmed_at,profiles(email)").not("import_confirmed_at", "is", null);
  if (requestedUserId) tokenQuery = tokenQuery.eq("user_id", requestedUserId);
  const { data: tokenRows, error: tokenError } = await tokenQuery;
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500, headers: corsHeaders });
  let totalSynced = 0; let totalContactsCreated = 0; let totalMeetingsSynced = 0;

  for (const tokenRow of (tokenRows ?? []) as TokenRow[]) {
    let batchSynced = 0; let batchContactsCreated = 0; let peopleProcessed = 0; let meetingsProcessed = 0;
    const sourceErrors: string[] = [];
    try {
      await admin.from("google_tokens").update({ sync_error: null, ...(!tokenRow.backfill_complete ? { backfill_started_at: new Date().toISOString() } : {}) }).eq("user_id", tokenRow.user_id);
      const accessToken = await gmailAccessToken(await decryptToken(tokenRow.refresh_token_encrypted));
      const profile = Array.isArray(tokenRow.profiles) ? tokenRow.profiles[0] : tokenRow.profiles;
      const ownEmail = profile?.email?.toLowerCase() ?? "";
      const ownDomain = ownEmail.split("@")[1] ?? "nikufra.ai";
      const ownBusinessDomain = publicEmailDomains.has(ownDomain) ? null : ownDomain;
      const isExternalEmail = (email?: string | null) => !email || (email.toLowerCase() !== ownEmail && (!ownBusinessDomain || email.split("@")[1]?.toLowerCase() !== ownBusinessDomain));
      const messageIds = new Set<string>();
      let newestHistory = tokenRow.history_id;
      let nextBackfillPage: string | null = tokenRow.backfill_page_token;
      let backfillComplete = tokenRow.backfill_complete;

      if (!backfillComplete) {
        if (!newestHistory) {
          const gmailProfile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken, "Gmail API");
          newestHistory = gmailProfile.historyId ?? null;
        }
        const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        listUrl.searchParams.set("maxResults", "100");
        if (nextBackfillPage) listUrl.searchParams.set("pageToken", nextBackfillPage);
        const payload = await googleJson(listUrl, accessToken, "Gmail API");
        for (const message of payload.messages ?? []) messageIds.add(message.id);
        nextBackfillPage = payload.nextPageToken ?? null;
        backfillComplete = !nextBackfillPage;
      } else if (newestHistory) {
        let pageToken = "";
        try {
          do {
            const historyUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
            const startHistoryId = newestHistory;
            if (!startHistoryId) break;
            historyUrl.searchParams.set("startHistoryId", startHistoryId);
            historyUrl.searchParams.set("historyTypes", "messageAdded");
            historyUrl.searchParams.set("maxResults", "100");
            if (pageToken) historyUrl.searchParams.set("pageToken", pageToken);
            const payload = await googleJson(historyUrl, accessToken, "Gmail API");
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
        try { return await googleJson(messageUrl, accessToken, "Gmail API") as Record<string, any>; } catch { return null; }
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

        // Elect a single owner for message-level effects when the same Google
        // mailbox is connected to both the CRM importer and Outreach. We still
        // upsert each CRM contact association below: the shared claim only
        // prevents global effects (metrics, stop-on-reply, suggestions, etc.)
        // from being applied twice.
        const { error: claimError } = await admin.rpc("claim_google_provider_message", {
          p_mailbox_email: ownEmail,
          p_provider_message_id: message.id,
        });
        if (claimError) throw new Error(`Falha ao deduplicar mensagem Google: ${claimError.message}`);

        // The claim elects the owner of message-wide side effects, but never
        // hides the per-contact CRM projection. Outreach may have claimed the
        // provider message first; each contact still needs its idempotent
        // timeline activity below. The composite unique key makes retries and
        // dual ingestion safe without dropping that association.

        for (const externalEmail of externalEmails) {
          const ensured = await ensureContact(admin, { userId: tokenRow.user_id, name: contactName(headerValue(headers, sent ? "To" : "From"), externalEmail), email: externalEmail, contacted: true, firstContact: date.slice(0, 10), source: "Gmail" });
          if (!ensured) continue;
          if (ensured.created) batchContactsCreated += 1;
          const { error: activityError } = await admin.from("atividades").upsert({ oportunidade_id: ensured.opportunity.id, empresa_id: ensured.contact.empresa_id, contacto_id: ensured.contact.id, user_id: tokenRow.user_id, tipo: sent ? "email_enviado" : "email_recebido", direcao: sent ? "enviado" : "recebido", data: date, descricao: subject.slice(0, 500), message_id: message.id, source_mailbox_email: ownEmail, thread_id: message.threadId, assunto: subject.slice(0, 500), snippet: String(message.snippet ?? "").slice(0, 240), reuniao_inferida: inferredMeeting }, { onConflict: "source_mailbox_email,message_id,contacto_id", ignoreDuplicates: true });
          if (activityError) throw activityError;
          const { error: evidenceError } = await admin.rpc("record_google_email_evidence", {
            p_user_id: tokenRow.user_id,
            p_contact_id: ensured.contact.id,
            p_email: externalEmail,
            p_mailbox_email: ownEmail,
            p_provider_message_id: message.id,
            p_direction: sent ? "sent" : "received",
          });
          if (evidenceError) throw new Error(`Falha ao registar origem Gmail: ${evidenceError.message}`);
          batchSynced += 1;
        }
      }

      let peopleSyncToken = tokenRow.people_sync_token; let otherContactsSyncToken = tokenRow.other_contacts_sync_token;
      try {
        const saved = await listPeople(accessToken, "connections", peopleSyncToken);
        for (const person of saved.people) {
          if (person.metadata?.deleted) continue;
          const seed = personSeed(person, tokenRow.user_id, "Google Contacts");
          if (!isExternalEmail(seed.email)) continue;
          const ensured = await ensureContact(admin, seed); peopleProcessed += 1;
          if (!ensured) continue;
          if (ensured.created) batchContactsCreated += 1;
        }
        peopleSyncToken = saved.nextSyncToken;
      } catch (error) { sourceErrors.push(error instanceof Error ? error.message : String(error)); }
      try {
        const other = await listPeople(accessToken, "other", otherContactsSyncToken);
        for (const person of other.people) {
          if (person.metadata?.deleted) continue;
          const seed = personSeed(person, tokenRow.user_id, "Google Contacts");
          if (!isExternalEmail(seed.email)) continue;
          const ensured = await ensureContact(admin, seed); peopleProcessed += 1;
          if (!ensured) continue;
          if (ensured.created) batchContactsCreated += 1;
        }
        otherContactsSyncToken = other.nextSyncToken;
      } catch (error) { sourceErrors.push(error instanceof Error ? error.message : String(error)); }

      let calendarSyncToken = tokenRow.calendar_sync_token; let calendarSucceeded = false;
      try {
        const calendar = await listCalendarEvents(accessToken, calendarSyncToken);
        calendarSyncToken = calendar.nextSyncToken;
        for (const event of calendar.events) {
          if (!event.id || event.status === "cancelled") {
            if (event.id) {
              await Promise.all([
                admin.from("atividades").delete().eq("calendar_event_id", event.id).eq("user_id", tokenRow.user_id),
                admin.from("google_calendar_events").delete().eq("google_event_id", event.id).eq("user_id", tokenRow.user_id),
              ]);
            }
            continue;
          }
          if (event.eventType && !["default", "fromGmail"].includes(event.eventType)) continue;
          const start = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T09:00:00.000Z` : null);
          if (!start) continue;
          const end = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T09:00:00.000Z` : start);
          const privateEvent = event.visibility === "private";
          const summary = privateEvent ? "Ocupado" : clean(event.summary, 500) || "Evento Google Calendar";
          const conferenceEntry = (event.conferenceData?.entryPoints ?? []).find((entry: Record<string, any>) => entry.entryPointType === "video");
          const { error: calendarEventError } = await admin.from("google_calendar_events").upsert({
            user_id: tokenRow.user_id,
            google_event_id: event.id,
            calendar_id: "primary",
            titulo: summary,
            inicio: start,
            fim: end,
            dia_inteiro: Boolean(event.start?.date),
            privado: privateEvent,
            estado: clean(event.status, 40) || "confirmed",
            localizacao: privateEvent ? null : clean(event.location, 500) || null,
            html_link: clean(event.htmlLink, 2000) || null,
            meet_link: clean(event.hangoutLink ?? conferenceEntry?.uri, 2000) || null,
            organizador_email: clean(event.organizer?.email, 320) || null,
            participantes: Array.isArray(event.attendees) ? event.attendees.filter((attendee: Record<string, any>) => attendee.responseStatus !== "declined").length : 0,
            google_updated_at: event.updated ?? null,
          }, { onConflict: "user_id,calendar_id,google_event_id" });
          if (calendarEventError) throw calendarEventError;
          const participants = new Map<string, string>();
          for (const attendee of event.attendees ?? []) if (attendee.email && attendee.responseStatus !== "declined" && isExternalEmail(attendee.email)) participants.set(attendee.email.toLowerCase(), attendee.displayName ?? attendee.email);
          if (event.organizer?.email && isExternalEmail(event.organizer.email)) participants.set(event.organizer.email.toLowerCase(), event.organizer.displayName ?? event.organizer.email);
          const seenCompanies = new Set<string>();
          for (const [email, name] of participants) {
            const ensured = await ensureContact(admin, { userId: tokenRow.user_id, name, email, contacted: true, source: "Google Calendar" });
            if (!ensured) continue;
            if (ensured.created) batchContactsCreated += 1;
            const meetingDate = start.slice(0, 10);
            const contactChanges: Record<string, unknown> = {};
            if ((stageRank[ensured.contact.estado] ?? 0) < stageRank.reuniao_marcada) contactChanges.estado = "reuniao_marcada";
            if (!ensured.contact.data_reuniao) contactChanges.data_reuniao = meetingDate;
            if (Object.keys(contactChanges).length) await admin.from("contactos").update(contactChanges).eq("id", ensured.contact.id);
            const opportunityChanges: Record<string, unknown> = {};
            if ((stageRank[ensured.opportunity.estado] ?? 0) < stageRank.reuniao_marcada) opportunityChanges.estado = "reuniao_marcada";
            if (!ensured.opportunity.data_reuniao) opportunityChanges.data_reuniao = meetingDate;
            if (Object.keys(opportunityChanges).length) await admin.from("oportunidades").update(opportunityChanges).eq("id", ensured.opportunity.id);
            if (seenCompanies.has(ensured.contact.empresa_id)) continue;
            seenCompanies.add(ensured.contact.empresa_id);
            const { error } = await admin.from("atividades").upsert({ oportunidade_id: ensured.opportunity.id, empresa_id: ensured.contact.empresa_id, contacto_id: ensured.contact.id, user_id: tokenRow.user_id, tipo: "reuniao", data: start, descricao: summary, calendar_event_id: event.id, assunto: summary, reuniao_inferida: false }, { onConflict: "calendar_event_id,contacto_id" });
            if (!error) meetingsProcessed += 1;
          }
        }
        calendarSucceeded = true;
      } catch (error) { sourceErrors.push(error instanceof Error ? error.message : String(error)); }

      const [{ count: exactMessageCount }, { count: exactCalendarCount }] = await Promise.all([
        admin.from("atividades").select("id", { count: "exact", head: true }).eq("user_id", tokenRow.user_id).not("message_id", "is", null),
        admin.from("google_calendar_events").select("id", { count: "exact", head: true }).eq("user_id", tokenRow.user_id),
      ]);
      const update = {
        history_id: newestHistory,
        backfill_page_token: nextBackfillPage,
        backfill_complete: backfillComplete,
        last_sync_at: new Date().toISOString(),
        messages_synced: exactMessageCount ?? Number(tokenRow.messages_synced || 0),
        contacts_created: Number(tokenRow.contacts_created || 0) + batchContactsCreated,
        people_sync_token: peopleSyncToken,
        other_contacts_sync_token: otherContactsSyncToken,
        calendar_sync_token: calendarSyncToken,
        people_contacts_synced: Number(tokenRow.people_contacts_synced || 0) + peopleProcessed,
        calendar_events_synced: exactCalendarCount ?? Number(tokenRow.calendar_events_synced || 0),
        calendar_last_sync_at: calendarSucceeded ? new Date().toISOString() : null,
        sync_error: sourceErrors.length ? sourceErrors.join(" · ").slice(0, 1000) : null,
      };
      await admin.from("google_tokens").update(update).eq("user_id", tokenRow.user_id);
      totalSynced += batchSynced; totalContactsCreated += batchContactsCreated; totalMeetingsSynced += meetingsProcessed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from("google_tokens").update({ sync_error: message.slice(0, 1000), last_sync_at: new Date().toISOString() }).eq("user_id", tokenRow.user_id);
      console.error(`Sync Google falhou para ${tokenRow.user_id}`, error);
    }
  }
  return Response.json({ synced: totalSynced, contactsCreated: totalContactsCreated, meetingsSynced: totalMeetingsSynced, accounts: tokenRows?.length ?? 0 }, { headers: corsHeaders });
});
