const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (request) => {
  const functionName = new URL(request.url).pathname.split("/").filter(Boolean)[0];
  if (request.method !== "OPTIONS" && functionName !== "gmail-oauth-callback") {
    const authorization = request.headers.get("authorization") ?? "";
    const isServiceRequest = authorization === `Bearer ${serviceKey}`;
    if (!isServiceRequest) {
      const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization, apikey: anonKey } });
      if (!authResponse.ok) return Response.json({ error: "JWT inválido" }, { status: 401 });
    }
  }

  if (!functionName || functionName === "main") return Response.json({ error: "Nome da função em falta" }, { status: 400 });

  try {
    const env = Object.entries(Deno.env.toObject());
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${functionName}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: "/home/deno/functions/deno.jsonc",
      envVars: env,
    });
    return await worker.fetch(request);
  } catch (error) {
    console.error("Falha no Edge worker", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
});
