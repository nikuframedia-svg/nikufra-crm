import { createServer } from "node:http";
import { authenticate, requireCapability } from "./auth.js";
import { buildRouter } from "./api-routes.js";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { HttpError, publicError, requestId } from "./errors.js";
import { json, safeRequestLogFields, setCors, setSecurityHeaders } from "./http.js";
import { aggregateRateLimitKey, FixedWindowRateLimiter, requestRateLimitKey } from "./rate-limit.js";

const router = buildRouter();
const rateLimiter = new FixedWindowRateLimiter();
const rateLimitPruneTimer = setInterval(() => rateLimiter.prune(), 5 * 60_000);
rateLimitPruneTimer.unref();

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  setCors(request, response);
  const id = requestId(request.headers["x-request-id"]);
  let logRoute = "unmatched";
  response.setHeader("x-request-id", id);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  try {
    const url = new URL(request.url ?? "/", config.publicUrl);
    const matched = router.match(request.method ?? "GET", url.pathname);
    if (!matched) throw new HttpError(404, "route_not_found", "Endpoint não encontrado.");
    logRoute = matched.route.path;
    const sensitive = /oauth|webhooks|unsubscribe/.test(matched.route.path);
    if (matched.route.path.includes("/unsubscribe/:token")) {
      // The aggregate bucket prevents an attacker from bypassing throttling by
      // rotating valid/invalid tokens; the per-flow bucket prevents one link
      // from starving every other user behind the same NAT or Caddy socket.
      rateLimiter.assert(aggregateRateLimitKey(request, matched.route.path), 120);
      rateLimiter.assert(requestRateLimitKey(request, matched.route.path, url), 10);
    } else if (matched.route.path.includes("/oauth/callback/") || matched.route.path.includes("/webhooks/")) {
      // A rotating OAuth state or provider event id must not bypass the
      // client/route budget. Keep a second, flow-specific bucket so one bad
      // callback/event does not starve unrelated traffic behind the proxy.
      rateLimiter.assert(aggregateRateLimitKey(request, matched.route.path), matched.route.path.includes("/webhooks/") ? 600 : 120);
      rateLimiter.assert(requestRateLimitKey(request, matched.route.path, url), 30);
    } else {
      rateLimiter.assert(requestRateLimitKey(request, matched.route.path, url), sensitive ? 30 : 240);
    }
    const actor = matched.route.public ? null : await authenticate(request);
    if (actor && matched.route.capability) requireCapability(actor, matched.route.capability);
    await matched.route.handler({ request, response, url, params: matched.params, actor, requestId: id });
  } catch (error) {
    const output = publicError(error, id);
    if (!(error instanceof HttpError) || error.status >= 500) {
      console.error("outreach api error", { requestId: id, ...safeRequestLogFields(request, logRoute), error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
    if (!response.headersSent) json(response, output.status, output.body);
    else response.destroy();
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "outreach_api_started", port: config.port, adminOnly: config.adminOnly, outboundEnvEnabled: config.outboundEnvEnabled }));
});

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "outreach_api_stopping", signal }));
  server.close();
  clearInterval(rateLimitPruneTimer);
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
