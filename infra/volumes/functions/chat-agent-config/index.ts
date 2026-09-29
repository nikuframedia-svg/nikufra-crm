import { activeUser, adminClient, corsHeaders, encryptToken } from "../_shared/security.ts";

type McpInput = { id?: string; nome?: string; url?: string; authorizationToken?: string; ativo?: boolean };
type AgentInput = {
  id?: string;
  nome?: string;
  descricao?: string;
  model?: string;
  instrucoes?: string;
  apiKey?: string;
  ativo?: boolean;
  mcpServers?: McpInput[];
};

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function validHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user, profile } = await activeUser(request);
    if (profile.role !== "admin") return Response.json({ error: "Apenas administradores podem configurar agentes" }, { status: 403, headers: corsHeaders });

    const input = await request.json() as AgentInput;
    const nome = cleanText(input.nome, 50);
    const descricao = cleanText(input.descricao, 300);
    const model = cleanText(input.model || "claude-sonnet-5", 100);
    const instrucoes = cleanText(input.instrucoes, 8_000);
    const apiKey = cleanText(input.apiKey, 500);
    const mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers.slice(0, 10) : [];

    if (nome.length < 2) return Response.json({ error: "Indica um nome para o agente" }, { status: 400, headers: corsHeaders });
    if (model.length < 2) return Response.json({ error: "Indica um modelo Anthropic válido" }, { status: 400, headers: corsHeaders });
    if (!input.id && !apiKey) return Response.json({ error: "A chave da Anthropic é obrigatória ao criar o agente" }, { status: 400, headers: corsHeaders });

    for (const server of mcpServers) {
      const serverName = cleanText(server.nome, 60);
      const serverUrl = cleanText(server.url, 1_000);
      if (serverName.length < 2 || !validHttpsUrl(serverUrl)) {
        return Response.json({ error: "Cada MCP precisa de nome e URL HTTPS pública" }, { status: 400, headers: corsHeaders });
      }
    }

    const admin = adminClient();
    const payload = { nome, descricao, provider: "anthropic", model, instrucoes, ativo: input.ativo !== false };
    const agentResult = input.id
      ? await admin.from("chat_agents").update(payload).eq("id", input.id).select("id,nome,descricao,provider,model,instrucoes,ativo").single()
      : await admin.from("chat_agents").insert({ ...payload, created_by: user.id }).select("id,nome,descricao,provider,model,instrucoes,ativo").single();
    if (agentResult.error || !agentResult.data) throw agentResult.error ?? new Error("Não foi possível guardar o agente");
    const agentId = agentResult.data.id;

    if (apiKey) {
      const { error } = await admin.from("chat_agent_secrets").upsert({ agent_id: agentId, api_key_encrypted: await encryptToken(apiKey) }, { onConflict: "agent_id" });
      if (error) throw error;
    }

    if (input.id) {
      const { error } = await admin.from("chat_agent_mcp_servers").delete().eq("agent_id", agentId);
      if (error) throw error;
    }
    if (mcpServers.length) {
      const rows = await Promise.all(mcpServers.map(async (server) => ({
        agent_id: agentId,
        nome: cleanText(server.nome, 60),
        url: cleanText(server.url, 1_000),
        authorization_token_encrypted: cleanText(server.authorizationToken, 2_000)
          ? await encryptToken(cleanText(server.authorizationToken, 2_000))
          : null,
        ativo: server.ativo !== false,
      })));
      const { error } = await admin.from("chat_agent_mcp_servers").insert(rows);
      if (error) throw error;
    }

    return Response.json({ agent: agentResult.data, mcpCount: mcpServers.length }, { headers: corsHeaders });
  } catch (error) {
    console.error("Falha ao configurar agente", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao configurar agente" }, { status: 400, headers: corsHeaders });
  }
});
