import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user, profile } = await activeUser(request);
    if (profile.role !== "admin") return Response.json({ error: "Apenas administradores podem eliminar contactos" }, { status: 403, headers: corsHeaders });
    const body = await request.json();
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))];
    if (!ids.length || ids.length > 200 || ids.some((id) => !uuidPattern.test(id))) throw new Error("Seleciona entre 1 e 200 contactos válidos");
    const admin = adminClient();
    const { data: contacts, error: readError } = await admin.from("contactos").select("id,email,google_resource_name").in("id", ids);
    if (readError) throw readError;
    for (const contact of contacts ?? []) {
      const suppression = { email: contact.email || null, google_resource_name: contact.google_resource_name || null, deleted_by: user.id };
      if (suppression.email || suppression.google_resource_name) {
        const { error } = await admin.from("contact_import_suppressions").insert(suppression);
        if (error && error.code !== "23505") throw error;
      }
      await admin.from("audit_log").insert({ actor_id: user.id, tabela: "contactos", registo_id: contact.id, acao: "RGPD_DELETE", alteracoes: { contacto_removido: true, reimportacao_google_bloqueada: true } });
    }
    const contactIds = (contacts ?? []).map((contact) => contact.id);
    if (contactIds.length) {
      const { error } = await admin.from("contactos").delete().in("id", contactIds);
      if (error) throw error;
    }
    return Response.json({ deleted: contactIds.length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao eliminar contactos" }, { status: 400, headers: corsHeaders });
  }
});
