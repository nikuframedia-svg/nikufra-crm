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
    const normalizedName = String(nome ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return Response.json({ error: "Endereço de email inválido" }, { status: 400, headers: corsHeaders });
    if (normalizedEmail.length > 320) return Response.json({ error: "Endereço de email demasiado longo" }, { status: 400, headers: corsHeaders });
    if (normalizedName.length < 2 || normalizedName.length > 120) return Response.json({ error: "O nome deve ter entre 2 e 120 caracteres" }, { status: 400, headers: corsHeaders });

    const { data: existingProfile, error: profileError } = await admin.from("profiles").select("id,ativo").eq("email", normalizedEmail).maybeSingle();
    if (profileError) throw profileError;
    if (existingProfile) {
      return Response.json({ error: existingProfile.ativo ? "Este endereço já tem acesso. Pode entrar com um novo magic link." : "Este endereço já tem uma conta a aguardar ativação." }, { status: 409, headers: corsHeaders });
    }

    const { data: previousInvitation, error: previousError } = await admin.from("user_invitations").select("email,nome,invited_by,invited_at,used_at").eq("email", normalizedEmail).maybeSingle();
    if (previousError) throw previousError;
    const invitation = { email: normalizedEmail, nome: normalizedName, invited_by: user.id, invited_at: new Date().toISOString(), used_at: null };
    const { error: invitationError } = await admin.from("user_invitations").upsert(invitation, { onConflict: "email" });
    if (invitationError) throw invitationError;
    const { error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, { data: { nome: normalizedName }, redirectTo: "nikufra-crm://auth/callback" });
    if (error) {
      if (previousInvitation) await admin.from("user_invitations").upsert(previousInvitation, { onConflict: "email" });
      else await admin.from("user_invitations").delete().eq("email", normalizedEmail).eq("invited_by", user.id);
      throw error;
    }
    return Response.json({ invited: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao convidar" }, { status: 400, headers: corsHeaders });
  }
});
