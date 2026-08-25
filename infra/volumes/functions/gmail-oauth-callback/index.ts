import { adminClient, encryptToken } from "../_shared/security.ts";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return Response.json({ error: "Callback OAuth incompleto" }, { status: 400 });
  const stateHash = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))));
  const admin = adminClient();
  const { data: stateRow } = await admin.from("google_oauth_states").select("id,user_id,expires_at,used_at").eq("state_hash", stateHash).single();
  if (!stateRow || stateRow.used_at || new Date(stateRow.expires_at) < new Date()) return Response.json({ error: "Estado OAuth inválido ou expirado" }, { status: 400 });
  await admin.from("google_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", stateRow.id);
  const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL")!;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, redirect_uri: `${publicUrl}/functions/v1/gmail-oauth-callback`, client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return Response.json({ error: "A troca do código Google falhou" }, { status: 502 });
  const tokens = await tokenResponse.json();
  if (!tokens.refresh_token) return Response.json({ error: "Refresh token em falta" }, { status: 409 });
  const googleProfileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!googleProfileResponse.ok) return Response.json({ error: "Não foi possível validar a conta Gmail autorizada" }, { status: 502 });
  const googleProfile = await googleProfileResponse.json();
  const { data: crmProfile } = await admin.from("profiles").select("email").eq("id", stateRow.user_id).single();
  if (!crmProfile?.email || String(googleProfile.emailAddress ?? "").toLowerCase() !== crmProfile.email.toLowerCase()) {
    return new Response("<!doctype html><html lang='pt'><meta charset='utf-8'><title>Conta incorreta</title><body><h1>Conta Google diferente</h1><p>Autoriza a mesma conta Google usada para entrar no CRM.</p></body></html>", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const { data: existing } = await admin.from("google_tokens").select("import_confirmed_at").eq("user_id", stateRow.user_id).maybeSingle();
  const encrypted = await encryptToken(tokens.refresh_token);
  const tokenRecord: Record<string, unknown> = { user_id: stateRow.user_id, refresh_token_encrypted: encrypted, scopes: ["gmail.readonly", "gmail.compose", "contacts.readonly", "contacts.other.readonly", "calendar.events.readonly"], sync_error: null };
  if (!existing) Object.assign(tokenRecord, { import_confirmed_at: null, history_id: null, backfill_page_token: null, backfill_complete: false, backfill_started_at: null, last_sync_at: null, messages_synced: 0, contacts_created: 0, people_sync_token: null, other_contacts_sync_token: null, calendar_sync_token: null, people_contacts_synced: 0, calendar_events_synced: 0, calendar_last_sync_at: null });
  const { error } = await admin.from("google_tokens").upsert(tokenRecord, { onConflict: "user_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return new Response("<!doctype html><html lang='pt'><meta charset='utf-8'><title>Google ligado</title><style>body{font:16px system-ui;background:#f5f6f7;color:#20242b;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:460px;border:1px solid #dfe3e8;background:#fff;padding:32px}h1{font-size:24px}p{color:#69717d;line-height:1.5}a{color:#2563eb}</style><main><h1>Conta Google ligada à Nikufra.</h1><p>Nenhum contacto foi importado. Revê os números no CRM e confirma a importação.</p><a href='nikufra-crm://oauth/google?status=connected'>Voltar ao CRM Nikufra</a></main><script>window.location.replace('nikufra-crm://oauth/google?status=connected')</script></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
});
