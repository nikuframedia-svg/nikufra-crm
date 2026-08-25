import { adminClient, authenticatedUser, corsHeaders } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile } = await admin.from("profiles").select("role,ativo").eq("id", user.id).single();
    if (!profile?.ativo || profile.role !== "admin") return Response.json({ error: "Apenas administradores" }, { status: 403, headers: corsHeaders });
    const { email, nome } = await request.json();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return Response.json({ error: "Endereço de email inválido" }, { status: 400, headers: corsHeaders });
    const { error: invitationError } = await admin.from("user_invitations").upsert({ email: normalizedEmail, nome: String(nome ?? "").trim(), invited_by: user.id, invited_at: new Date().toISOString(), used_at: null }, { onConflict: "email" });
    if (invitationError) throw invitationError;
    const { error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, { data: { nome: String(nome ?? "") }, redirectTo: "nikufra-crm://auth/callback" });
    if (error) {
      await admin.from("user_invitations").delete().eq("email", normalizedEmail).eq("invited_by", user.id);
      throw error;
    }
    return Response.json({ invited: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao convidar" }, { status: 400, headers: corsHeaders });
  }
});
