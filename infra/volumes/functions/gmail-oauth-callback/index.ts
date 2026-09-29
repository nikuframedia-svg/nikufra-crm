import { adminClient, encryptToken } from "../_shared/security.ts";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function appRedirect(error?: string) {
  const destination = new URL("/", Deno.env.get("APP_PUBLIC_URL") ?? Deno.env.get("SUPABASE_PUBLIC_URL")!);
  if (error) destination.searchParams.set("google_error", error);
  return Response.redirect(destination.toString(), 303);
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) return appRedirect(url.searchParams.get("error_description") ?? providerError);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return appRedirect("A resposta da Google está incompleta. Tenta novamente.");
  const stateHash = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))));
  const admin = adminClient();
  const { data: stateRow } = await admin.from("google_oauth_states").select("id,user_id,expires_at,used_at").eq("state_hash", stateHash).single();
  if (!stateRow || stateRow.used_at || new Date(stateRow.expires_at) < new Date()) return appRedirect("A autorização Google expirou. Tenta novamente.");
  await admin.from("google_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", stateRow.id);
  const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL")!;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, redirect_uri: `${publicUrl}/functions/v1/gmail-oauth-callback`, client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return appRedirect("A Google não concluiu a autorização. Tenta novamente.");
  const tokens = await tokenResponse.json();
  if (!tokens.refresh_token) return appRedirect("A Google não devolveu acesso permanente. Autoriza novamente a conta.");
  const googleProfileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!googleProfileResponse.ok) return appRedirect("Não foi possível validar a conta Gmail autorizada.");
  const googleProfile = await googleProfileResponse.json();
  const { data: crmProfile } = await admin.from("profiles").select("email").eq("id", stateRow.user_id).single();
  if (!crmProfile?.email || String(googleProfile.emailAddress ?? "").toLowerCase() !== crmProfile.email.toLowerCase()) {
    return appRedirect("Autoriza a mesma conta Google usada para entrar no CRM.");
  }
  const { data: existing } = await admin.from("google_tokens").select("import_confirmed_at").eq("user_id", stateRow.user_id).maybeSingle();
  const encrypted = await encryptToken(tokens.refresh_token);
  const tokenRecord: Record<string, unknown> = { user_id: stateRow.user_id, refresh_token_encrypted: encrypted, scopes: ["gmail.readonly", "gmail.compose", "contacts.readonly", "contacts.other.readonly", "calendar.events.readonly"], sync_error: null };
  if (!existing) Object.assign(tokenRecord, { import_confirmed_at: null, history_id: null, backfill_page_token: null, backfill_complete: false, backfill_started_at: null, last_sync_at: null, messages_synced: 0, contacts_created: 0, people_sync_token: null, other_contacts_sync_token: null, calendar_sync_token: null, people_contacts_synced: 0, calendar_events_synced: 0, calendar_last_sync_at: null });
  const { error } = await admin.from("google_tokens").upsert(tokenRecord, { onConflict: "user_id" });
  if (error) return appRedirect("A ligação Google não pôde ser guardada. Tenta novamente.");
  return appRedirect();
});
