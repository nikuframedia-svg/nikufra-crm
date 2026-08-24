import { adminClient, authenticatedUser, corsHeaders } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile } = await admin.from("profiles").select("role,ativo").eq("id", user.id).single();
    if (!profile?.ativo || profile.role !== "admin") return Response.json({ error: "Apenas administradores" }, { status: 403, headers: corsHeaders });
    const { email, nome } = await request.json();
    if (!String(email).toLowerCase().endsWith("@nikufra.ai")) return Response.json({ error: "Usa um endereço @nikufra.ai" }, { status: 400, headers: corsHeaders });
    const { error } = await admin.auth.admin.inviteUserByEmail(String(email).toLowerCase(), { data: { nome: String(nome ?? "") }, redirectTo: "nikufra-crm://auth/callback" });
    if (error) throw error;
    return Response.json({ invited: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao convidar" }, { status: 400, headers: corsHeaders });
  }
});
