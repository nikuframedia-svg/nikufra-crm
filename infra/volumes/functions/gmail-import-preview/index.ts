import { activeUser, adminClient, corsHeaders, decryptToken, gmailAccessToken } from "../_shared/security.ts";

async function googleJson(url: URL | string, accessToken: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google API falhou (${response.status})`);
  return response.json();
}

async function peopleEmails(accessToken: string, kind: "connections" | "other") {
  const emails = new Set<string>();
  let pageToken = "";
  do {
    const url = new URL(kind === "connections" ? "https://people.googleapis.com/v1/people/me/connections" : "https://people.googleapis.com/v1/otherContacts");
    url.searchParams.set(kind === "connections" ? "personFields" : "readMask", "emailAddresses");
    url.searchParams.set("pageSize", "1000");
    if (kind === "connections") url.searchParams.set("sources", "READ_SOURCE_TYPE_CONTACT");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await googleJson(url, accessToken);
    for (const person of (kind === "connections" ? payload.connections ?? [] : payload.otherContacts ?? [])) {
      for (const address of person.emailAddresses ?? []) {
        const email = String(address.value ?? "").trim().toLowerCase();
        if (email.includes("@")) emails.add(email);
      }
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return emails;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await activeUser(request);
    const admin = adminClient();
    const { data: token, error } = await admin.from("google_tokens").select("refresh_token_encrypted").eq("user_id", user.id).single();
    if (error || !token) throw new Error("Conta Google ainda não ligada");
    const accessToken = await gmailAccessToken(await decryptToken(token.refresh_token_encrypted));
    const [gmailProfile, connections, other] = await Promise.all([
      googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken),
      peopleEmails(accessToken, "connections"),
      peopleEmails(accessToken, "other"),
    ]);
    const ownEmail = String(gmailProfile.emailAddress ?? user.email ?? "").toLowerCase();
    const found = new Set([...connections, ...other]);
    found.delete(ownEmail);
    const existing = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error: contactsError } = await admin.from("contactos").select("email").not("email", "is", null).range(from, from + 999);
      if (contactsError) throw contactsError;
      for (const contact of data ?? []) existing.add(String(contact.email).toLowerCase());
      if ((data?.length ?? 0) < 1000) break;
    }
    let contactsExisting = 0;
    for (const email of found) if (existing.has(email)) contactsExisting += 1;
    const result = { messagesFound: Number(gmailProfile.messagesTotal ?? 0), contactsFound: found.size, contactsExisting, contactsNew: found.size - contactsExisting };
    await admin.from("google_tokens").update({ preview_messages_found: result.messagesFound, preview_contacts_found: result.contactsFound, preview_contacts_existing: result.contactsExisting, preview_scanned_at: new Date().toISOString() }).eq("user_id", user.id);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao analisar a conta Google" }, { status: 400, headers: corsHeaders });
  }
});
