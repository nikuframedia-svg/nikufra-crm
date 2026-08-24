import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok", service: "nikufra-edge" });
  }
  return Response.json({ error: "Função não encontrada" }, { status: 404 });
});
