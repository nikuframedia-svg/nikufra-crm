import { adminClient, corsHeaders, decryptToken, gmailAccessToken } from "../_shared/security.ts";

function headerValue(headers: Array<{ name: string; value: string }>, name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function addresses(value: string) {
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.headers.get("authorization") !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return Response.json({ error: "Apenas scheduler" }, { status: 403, headers: corsHeaders });
  const admin = adminClient();
  const { data: tokenRows, error: tokenError } = await admin.from("google_tokens").select("user_id,refresh_token_encrypted,history_id,profiles(email)");
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500, headers: corsHeaders });
  let synced = 0;

  for (const tokenRow of tokenRows ?? []) {
    try {
      const accessToken = await gmailAccessToken(await decryptToken(tokenRow.refresh_token_encrypted));
      const profile = Array.isArray(tokenRow.profiles) ? tokenRow.profiles[0] : tokenRow.profiles;
      const ownEmail = profile?.email?.toLowerCase() ?? "";
      const messageIds = new Set<string>();
      let newestHistory = tokenRow.history_id;

      if (tokenRow.history_id) {
        let pageToken = "";
        do {
          const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
          url.searchParams.set("startHistoryId", tokenRow.history_id);
          url.searchParams.set("historyTypes", "messageAdded");
          url.searchParams.set("maxResults", "100");
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
          if (response.status === 404) { newestHistory = null; break; }
          if (!response.ok) throw new Error(`Gmail history falhou (${response.status})`);
          const payload = await response.json();
          for (const history of payload.history ?? []) for (const added of history.messagesAdded ?? []) messageIds.add(added.message.id);
          newestHistory = payload.historyId ?? newestHistory;
          pageToken = payload.nextPageToken ?? "";
        } while (pageToken);
      }

      if (!tokenRow.history_id || newestHistory === null) {
        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=newer_than%3A30d", { headers: { authorization: `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error(`Gmail list falhou (${response.status})`);
        const payload = await response.json();
        for (const message of payload.messages ?? []) messageIds.add(message.id);
      }

      for (const messageId of messageIds) {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`;
        const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
        if (!response.ok) continue;
        const message = await response.json();
        newestHistory = message.historyId ?? newestHistory;
        const headers = message.payload?.headers ?? [];
        const from = addresses(headerValue(headers, "From"));
        const to = addresses(headerValue(headers, "To"));
        const sent = from.includes(ownEmail);
        const externalEmails = (sent ? to : from).filter((email) => email !== ownEmail);
        if (!externalEmails.length) continue;
        const { data: contacts } = await admin.from("contactos").select("id,empresa_id,email,oportunidades(id)").in("email", externalEmails);
        for (const contact of contacts ?? []) {
          const opportunities = contact.oportunidades as Array<{ id: string }> | null;
          await admin.from("atividades").upsert({ oportunidade_id: opportunities?.[0]?.id ?? null, empresa_id: contact.empresa_id, contacto_id: contact.id, user_id: tokenRow.user_id, tipo: sent ? "email_enviado" : "email_recebido", data: new Date(Number(message.internalDate)).toISOString(), descricao: headerValue(headers, "Subject") || "Email sem assunto", message_id: message.id, thread_id: message.threadId, assunto: headerValue(headers, "Subject"), snippet: message.snippet?.slice(0, 240) ?? "" }, { onConflict: "message_id", ignoreDuplicates: true });
          synced += 1;
        }
      }
      if (newestHistory) await admin.from("google_tokens").update({ history_id: newestHistory }).eq("user_id", tokenRow.user_id);
    } catch (error) {
      console.error(`Sync Gmail falhou para ${tokenRow.user_id}`, error);
    }
  }
  return Response.json({ synced }, { headers: corsHeaders });
});
