import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user, profile } = await activeUser(request);
    if (profile.role !== "admin") return Response.json({ error: "Apenas administradores podem apagar lançamentos" }, { status: 403, headers: corsHeaders });
    const { id } = await request.json() as { id?: string };
    if (!id) return Response.json({ error: "Lançamento em falta" }, { status: 400, headers: corsHeaders });

    const admin = adminClient();
    const { data, error } = await admin.rpc("delete_billing_entry", { target_entry_id: id, actor_user_id: user.id });
    if (error) throw error;
    return Response.json(data, { headers: corsHeaders });
  } catch (error) {
    console.error("Falha ao apagar lançamento", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao apagar lançamento" }, { status: 400, headers: corsHeaders });
  }
});
