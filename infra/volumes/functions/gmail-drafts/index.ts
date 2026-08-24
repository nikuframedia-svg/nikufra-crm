import { adminClient, authenticatedUser, corsHeaders, decryptToken, gmailAccessToken } from "../_shared/security.ts";

type DraftRequest = { contactoId: string; destinatario: string; assunto: string; mensagem: string };

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await authenticatedUser(request);
    const { drafts } = await request.json() as { drafts: DraftRequest[] };
    if (!Array.isArray(drafts) || drafts.length === 0 || drafts.length > 100) return Response.json({ error: "Seleciona entre 1 e 100 destinatários" }, { status: 400, headers: corsHeaders });
    const admin = adminClient();
    const [{ data: tokenRow, error: tokenError }, { data: contacts, error: contactsError }] = await Promise.all([
      admin.from("google_tokens").select("refresh_token_encrypted").eq("user_id", user.id).single(),
      admin.from("contactos").select("id,email,optout").in("id", drafts.map((draft) => draft.contactoId)),
    ]);
    if (tokenError || !tokenRow) return Response.json({ error: "Liga primeiro a conta Gmail" }, { status: 409, headers: corsHeaders });
    if (contactsError) throw contactsError;
    const eligible = new Map((contacts ?? []).filter((contact) => !contact.optout).map((contact) => [contact.id, contact.email?.toLowerCase()]));
    const filtered = drafts.filter((draft) => eligible.get(draft.contactoId) === draft.destinatario.toLowerCase());
    const accessToken = await gmailAccessToken(await decryptToken(tokenRow.refresh_token_encrypted));
    const results = await Promise.all(filtered.map(async (draft) => {
      const mime = [`To: ${draft.destinatario}`, `Subject: ${draft.assunto}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", draft.mensagem].join("\r\n");
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ message: { raw: base64Url(mime) } }) });
      if (!response.ok) throw new Error(`Falha ao criar rascunho para ${draft.destinatario}`);
      return response.json();
    }));
    return Response.json({ created: results.length, excluded: drafts.length - filtered.length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao criar rascunhos" }, { status: 400, headers: corsHeaders });
  }
});
