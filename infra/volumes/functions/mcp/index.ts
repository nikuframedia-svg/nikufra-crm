import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { activeUser } from "../_shared/security.ts";

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };

const publicUrl = (Deno.env.get("APP_PUBLIC_URL") ?? "https://crm.nikufra.ai").replace(/\/$/, "");
const resourceUrl = `${publicUrl}/functions/v1/mcp`;
const authorizationServer = `${publicUrl}/auth/v1`;
const resourceMetadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
};

const tools = [
  {
    name: "search_companies",
    description: "Pesquisa empresas do CRM Nikufra pelo nome e devolve contactos e oportunidades associados. Apenas leitura.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nome completo ou parcial da empresa." },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_company",
    description: "Obtém a ficha completa de uma empresa, incluindo contactos, oportunidades, atividade e faturação. Apenas leitura.",
    inputSchema: {
      type: "object",
      properties: { company_id: { type: "string", format: "uuid" } },
      required: ["company_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_pipeline",
    description: "Lista oportunidades do pipeline, opcionalmente filtradas por estado ou responsável. Apenas leitura.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["nao_contactado", "contactado", "reuniao_marcada", "reuniao_feita", "piloto", "proposta", "cliente", "perdido", "adiado"] },
        owner_id: { type: "string", format: "uuid" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_follow_up_suggestions",
    description: "Lista sugestões de follow-up ordenadas pela antiguidade da última interação e número de mensagens. Apenas leitura.",
    inputSchema: {
      type: "object",
      properties: {
        min_days: { type: "integer", minimum: 0, maximum: 3650, default: 0 },
        max_days: { type: "integer", minimum: 0, maximum: 3650 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
] as const;

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(payload, { status, headers: { ...corsHeaders, ...extraHeaders } });
}

function rpcResult(id: JsonRpcId | undefined, result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result }, 200, { "mcp-protocol-version": "2025-06-18" });
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, status = 200) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status, { "mcp-protocol-version": "2025-06-18" });
}

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function userClient(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
}

async function runTool(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  if (name === "search_companies") {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("Indica o nome a pesquisar.");
    const limit = boundedInteger(args.limit, 10, 1, 25);
    const { data, error } = await client.from("empresas")
      .select("id,nome,vertical,cidade,pais,website,notas,contactos(id,nome,cargo,email,telefone,principal,optout),oportunidades(id,titulo,estado,valor_estimado,probabilidade,owner_id,data_prevista_fecho,updated_at)")
      .eq("arquivado", false)
      .ilike("nome", `%${query}%`)
      .order("nome")
      .limit(limit);
    if (error) throw error;
    return { query, count: data?.length ?? 0, companies: data ?? [] };
  }

  if (name === "get_company") {
    const companyId = String(args.company_id ?? "").trim();
    if (!companyId) throw new Error("Indica o identificador da empresa.");
    const [company, activities, billing] = await Promise.all([
      client.from("empresas").select("id,nome,nif,website,vertical,pais,cidade,num_colaboradores,num_unidades_fabris,erp,mes,nivel_maturidade_digital,origem,notas,updated_at,contactos(id,nome,cargo,email,telefone,linkedin_url,principal,optout,notas),oportunidades(id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,probabilidade,data_prevista_fecho,data_primeiro_contacto,data_reuniao,data_proposta,data_piloto,data_fecho,ciclo_acordo_meses,avaliacao,motivo_perda,notas_perda,notas,owner_id,updated_at)").eq("id", companyId).eq("arquivado", false).maybeSingle(),
      client.from("atividades").select("id,tipo,data,duracao_min,descricao,assunto,snippet,user_id,contacto_id,oportunidade_id").eq("empresa_id", companyId).order("data", { ascending: false }).limit(100),
      client.from("faturacao").select("id,tipo,valor,valor_bruto,iva,taxa_iva,data,descricao,recorrente,referencia_externa,oportunidade_id").eq("empresa_id", companyId).order("data", { ascending: false }).limit(100),
    ]);
    const firstError = company.error ?? activities.error ?? billing.error;
    if (firstError) throw firstError;
    if (!company.data) throw new Error("Empresa não encontrada ou sem acesso.");
    return { company: company.data, recent_activities: activities.data ?? [], billing: billing.data ?? [] };
  }

  if (name === "list_pipeline") {
    const limit = boundedInteger(args.limit, 50, 1, 100);
    let query = client.from("oportunidades")
      .select("id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,probabilidade,data_prevista_fecho,data_primeiro_contacto,data_fecho,ciclo_acordo_meses,avaliacao,owner_id,contacto_principal_id,updated_at,empresas(id,nome)")
      .eq("arquivado", false)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (args.stage) query = query.eq("estado", String(args.stage));
    if (args.owner_id) query = query.eq("owner_id", String(args.owner_id));
    const { data, error } = await query;
    if (error) throw error;
    return { count: data?.length ?? 0, opportunities: data ?? [] };
  }

  if (name === "list_follow_up_suggestions") {
    const now = Date.now();
    const minimumDays = boundedInteger(args.min_days, 0, 0, 3650);
    const maximumDays = args.max_days == null ? null : boundedInteger(args.max_days, 3650, minimumDays, 3650);
    const limit = boundedInteger(args.limit, 25, 1, 100);
    const { data, error } = await client.from("follow_up_suggestions").select("*");
    if (error) throw error;
    const suggestions = (data ?? []).map((item) => ({
      ...item,
      days_since_last_interaction: Math.max(0, Math.floor((now - new Date(item.ultima_interacao_em).getTime()) / 86_400_000)),
    })).filter((item) => item.days_since_last_interaction >= minimumDays && (maximumDays === null || item.days_since_last_interaction <= maximumDays))
      .sort((left, right) => right.days_since_last_interaction - left.days_since_last_interaction || Number(right.total_mensagens) - Number(left.total_mensagens))
      .slice(0, limit);
    return { count: suggestions.length, min_days: minimumDays, max_days: maximumDays, suggestions };
  }

  throw new Error(`Ferramenta desconhecida: ${name}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json({ resource: resourceUrl, authorization_servers: [authorizationServer], scopes_supported: ["email", "profile"], bearer_methods_supported: ["header"] });
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });

  try {
    await activeUser(request);
  } catch {
    return json({ error: "invalid_token", error_description: "Liga a tua conta Nikufra para usar este conector." }, 401, {
      "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    });
  }

  let payload: JsonRpcRequest;
  try {
    payload = await request.json() as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "JSON inválido", 400);
  }

  if (payload.method === "initialize") {
    return rpcResult(payload.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "Nikufra CRM", version: "1.0.0" },
      instructions: "Conector Nikufra CRM apenas de leitura. Nunca inventes dados ausentes e identifica sempre a empresa antes de consultar a ficha.",
    });
  }
  if (payload.method === "notifications/initialized") return new Response(null, { status: 202, headers: corsHeaders });
  if (payload.method === "ping") return rpcResult(payload.id, {});
  if (payload.method === "tools/list") return rpcResult(payload.id, { tools });
  if (payload.method === "tools/call") {
    const name = String(payload.params?.name ?? "");
    try {
      return rpcResult(payload.id, textResult(await runTool(userClient(request), name, payload.params?.arguments ?? {})));
    } catch (error) {
      return rpcResult(payload.id, { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Não foi possível consultar o CRM." }] });
    }
  }
  return rpcError(payload.id, -32601, `Método não suportado: ${payload.method ?? ""}`);
});
