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
  const encrypted = await encryptToken(tokens.refresh_token);
  const { error } = await admin.from("google_tokens").upsert({ user_id: stateRow.user_id, refresh_token_encrypted: encrypted, scopes: ["gmail.readonly", "gmail.compose"] }, { onConflict: "user_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return new Response("<!doctype html><html lang='pt'><meta charset='utf-8'><title>Gmail ligado</title><style>body{font:16px system-ui;background:#0e1116;color:#e4e7eb;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:460px;border:1px solid #2b313c;padding:32px}h1{font-size:24px}p{color:#929aa8;line-height:1.5}a{color:#60a5fa}</style><main><h1>Gmail ligado à Nikufra.</h1><p>A sincronização começou. Volta ao CRM para continuar.</p><a href='nikufra-crm://oauth/google?status=connected'>Abrir o CRM Nikufra</a></main></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
});
