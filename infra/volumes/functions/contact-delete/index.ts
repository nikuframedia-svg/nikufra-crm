import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user, profile } = await activeUser(request);
    if (profile.role !== "admin") return Response.json({ error: "Apenas administradores podem eliminar contactos" }, { status: 403, headers: corsHeaders });
    const body = await request.json();
    const ids: string[] = [...new Set<string>((Array.isArray(body.ids) ? body.ids : []).map((id: unknown) => String(id)))];
    const companyIds: string[] = [...new Set<string>((Array.isArray(body.companyIds) ? body.companyIds : []).map((id: unknown) => String(id)))];
    const opportunityIds: string[] = [...new Set<string>((Array.isArray(body.opportunityIds) ? body.opportunityIds : []).map((id: unknown) => String(id)))];
    const allIds = [...ids, ...companyIds, ...opportunityIds];
    if (!allIds.length || allIds.length > 200 || allIds.some((id) => !uuidPattern.test(id))) throw new Error("Seleciona entre 1 e 200 registos válidos");
    const admin = adminClient();
    const { data, error } = await admin.rpc("delete_commercial_records", {
      p_contact_ids: ids,
      p_company_ids: companyIds,
      p_opportunity_ids: opportunityIds,
      p_actor_id: user.id,
    });
    if (error) throw error;
    return Response.json(data ?? { deleted: 0 }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao eliminar contactos" }, { status: 400, headers: corsHeaders });
  }
});
