import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await activeUser(request);
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const stateHash = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))));
    const { error } = await adminClient().from("google_oauth_states").insert({ user_id: user.id, state_hash: stateHash });
    if (error) throw error;
    const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL")!;
    const params = new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, redirect_uri: `${publicUrl}/functions/v1/gmail-oauth-callback`, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose", state });
    return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao iniciar OAuth" }, { status: 400, headers: corsHeaders });
  }
});
