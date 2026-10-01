import { createServer } from "node:http";
import { config } from "./config.js";
import { checkDatabase, closeDatabase } from "./db.js";
import { processWebhookEvents, purgeInboundReconciliation, syncAllMailboxes } from "./inbound.js";
import { runSchedulerCycle, type ShadowEvaluation } from "./scheduler.js";
import { recordWorkerHeartbeat, workerReadiness, type WorkerHeartbeat } from "./heartbeat.js";

let stopping = false;
let schedulerRunning = false;
let inboundRunning = false;
let lastSchedulerAt: string | null = null;
let lastInboundAt: string | null = null;
let schedulerError: string | null = null;
let inboundError: string | null = null;
let heartbeatError: string | null = null;
let lastShadowResult: ShadowEvaluation | null = null;
let lastHeartbeat: WorkerHeartbeat | null = null;

async function heartbeatTick(healthy = schedulerError === null && inboundError === null) {
  try {
    lastHeartbeat = await recordWorkerHeartbeat(healthy);
    heartbeatError = null;
  } catch (error) {
    heartbeatError = error instanceof Error ? error.message : String(error);
    console.error("outreach worker heartbeat failed", { error: heartbeatError });
  }
}

async function schedulerTick() {
  if (schedulerRunning || stopping) return;
  schedulerRunning = true;
  try {
    const result = await runSchedulerCycle();
    if (result.mode === "shadow") {
      lastShadowResult = result.shadow;
      console.log(JSON.stringify({ event: "outreach_shadow_evaluation", ...result.shadow }));
    } else {
      for (const failure of result.failures) console.error("outreach dispatch failed", { error: failure });
    }
    lastSchedulerAt = new Date().toISOString();
    schedulerError = null;
  } catch (error) {
    schedulerError = error instanceof Error ? error.message : String(error);
    console.error("outreach scheduler tick failed", { error: schedulerError });
    await heartbeatTick(false);
  } finally {
    schedulerRunning = false;
  }
}

async function inboundTick() {
  if (inboundRunning || stopping) return;
  inboundRunning = true;
  try {
    const webhooks = await processWebhookEvents();
    // A webhook batch already performs the mailbox synchronization before it
    // is acknowledged. The periodic path only needs a separate pass when no
    // webhook was waiting.
    if (!webhooks.processed) await syncAllMailboxes();
    await purgeInboundReconciliation();
    lastInboundAt = new Date().toISOString();
    inboundError = null;
  } catch (error) {
    inboundError = error instanceof Error ? error.message : String(error);
    console.error("outreach inbound tick failed", { error: inboundError });
    await heartbeatTick(false);
  } finally {
    inboundRunning = false;
  }
}

const health = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname !== "/healthz" && pathname !== "/readyz") {
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json");
  if (pathname === "/healthz") {
    response.statusCode = 200;
    response.end(JSON.stringify({ status: "ok", service: "outreach-worker" }));
    return;
  }
  try {
    await checkDatabase();
    const readiness = workerReadiness({ lastHeartbeat, lastSchedulerAt, lastInboundAt, schedulerError, inboundError, heartbeatError });
    response.statusCode = readiness.ready ? 200 : 503;
    response.end(JSON.stringify({ status: readiness.ready ? "ready" : "not_ready", service: "outreach-worker", schedulerRunning, inboundRunning, lastSchedulerAt, lastInboundAt, errors: readiness.errors.length ? readiness.errors.map(() => "worker_cycle_failed") : [], checks: { heartbeatFresh: readiness.heartbeatFresh, schedulerFresh: readiness.schedulerFresh, inboundFresh: readiness.inboundFresh }, lastHeartbeat, outboundEnvEnabled: config.outboundEnvEnabled, shadowMode: config.shadowMode, lastShadowResult }));
  } catch {
    response.statusCode = 503;
    response.end(JSON.stringify({ status: "not_ready", error: "database_unavailable" }));
  }
});

health.listen(config.workerHealthPort, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "outreach_worker_started", healthPort: config.workerHealthPort, outboundEnvEnabled: config.outboundEnvEnabled, inboundEnabled: config.inboundEnabled }));
});

void schedulerTick();
void inboundTick();
void heartbeatTick(true);
const schedulerTimer = setInterval(() => void schedulerTick(), config.schedulerIntervalMs);
const inboundTimer = setInterval(() => void inboundTick(), config.inboundIntervalMs);
const heartbeatTimer = setInterval(() => void heartbeatTick(), 60_000);
schedulerTimer.unref();
inboundTimer.unref();
heartbeatTimer.unref();

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "outreach_worker_stopping", signal }));
  clearInterval(schedulerTimer);
  clearInterval(inboundTimer);
  clearInterval(heartbeatTimer);
  health.close();
  const deadline = Date.now() + 25_000;
  while ((schedulerRunning || inboundRunning) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  await heartbeatTick(false);
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
