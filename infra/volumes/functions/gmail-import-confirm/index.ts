import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await activeUser(request);
    const { data: token, error: readError } = await adminClient().from("google_tokens").select("user_id").eq("user_id", user.id).single();
    if (readError || !token) throw new Error("Conta Google ainda não ligada");
    const { error } = await adminClient().from("google_tokens").update({ import_confirmed_at: new Date().toISOString(), backfill_complete: false, backfill_page_token: null, history_id: null, sync_error: null }).eq("user_id", user.id);
    if (error) throw error;
    return Response.json({ confirmed: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao confirmar a importação" }, { status: 400, headers: corsHeaders });
  }
});
