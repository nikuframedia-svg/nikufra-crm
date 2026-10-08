import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertOrigin, requireCapability } from "./auth.js";
import { config } from "./config.js";
import { sha256, verifyHmac, randomToken } from "./crypto.js";
import { checkDatabase, pool, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import { html, json, pageParams, readJson, readRaw, singleHeader } from "./http.js";
import { processWebhookEvents, storeWebhook, syncMailbox } from "./inbound.js";
import { sendThreadReply } from "./delivery.js";
import {
  addAudienceContacts,
  advanceMailboxRamp,
  campaignAction,
  contactEligibility,
  createAudience,
  createCampaign,
  disconnectMailbox,
  createMailbox,
  createSuppression,
  createSuppressionWithClient,
  deactivateSuppression,
  recordDnsCheck,
  recordEmailVerificationEvidence,
  ignoreInboundReconciliation,
  adjudicateJobReconciliation,
  updateCampaign,
  queueCampaignMessageTest,
  updateMailbox,
  updateThread,
  updateSystemSettings,
  verifyContacts,
  revokeMailboxAuthorizationBestEffort,
} from "./mutations.js";
import { buildAuthorizationUrl, exchangeAuthorizationCode, fetchOAuthIdentity } from "./oauth.js";
import { revokeProviderAuthorization, testProvider } from "./providers.js";
import {
  consumeOAuthState,
  createOAuthState,
  assertOAuthCallbackAuthorized,
  deleteMailboxCredential,
  getCampaign,
  getMailbox,
  getThread,
  listAudit,
  listInboundReconciliation,
  listJobReconciliation,
  listAudiences,
  listCampaigns,
  listCampaignRecipients,
  searchMessageTestContacts,
  listCampaignMessageTests,
  listMailboxes,
  listSuppressions,
  listThreads,
  markMailboxConnected,
  metrics,
  overview,
  providerSession,
  prepareMailboxReauthorization,
  settings,
} from "./repository.js";
import { Router } from "./router.js";

const API = "/api/outreach/v1";
const uuid = z.uuid();

function actor(context: { actor: import("./types.js").Actor | null }) {
  if (!context.actor) throw new HttpError(401, "authentication_required", "É necessária uma sessão CRM.");
  return context.actor;
}

function success(context: { response: import("node:http").ServerResponse }, data: unknown, status = 200) {
  json(context.response, status, { data });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildRouter() {
  const router = new Router();

  const healthHandler = async ({ response }: import("./router.js").RouteContext) => {
    json(response, 200, { status: "ok", service: "outreach-api" });
  };
  router.add("GET", "/healthz", healthHandler, { public: true });
  router.add("GET", `${API}/healthz`, healthHandler, { public: true });
  router.add("GET", "/readyz", async ({ response }) => {
    const databaseTime = await checkDatabase();
    json(response, 200, { status: "ready", databaseTime });
  }, { public: true });

  router.add("GET", `${API}/overview`, async (context) => success(context, await overview(actor(context))), { capability: "outreach.read" });
  router.add("GET", `${API}/metrics`, async (context) => success(context, await metrics(Number(context.url.searchParams.get("days")) || 30)), { capability: "outreach.read" });

  router.add("GET", `${API}/campaigns`, async (context) => success(context, await listCampaigns(pageParams(context.url), context.url.searchParams.get("search") ?? "")), { capability: "outreach.read" });
  router.add("POST", `${API}/campaigns`, async (context) => {
    assertOrigin(context.request);
    success(context, await createCampaign(actor(context), await readJson(context.request)), 201);
  }, { capability: "outreach.campaign.manage" });
  router.add("GET", `${API}/campaigns/:campaignId`, async (context) => success(context, await getCampaign(uuid.parse(context.params.campaignId))), { capability: "outreach.read" });
  router.add("GET", `${API}/campaigns/:campaignId/recipients`, async (context) => success(context, await listCampaignRecipients(uuid.parse(context.params.campaignId), pageParams(context.url))), { capability: "outreach.campaign.manage" });
  router.add("GET", `${API}/campaigns/:campaignId/message-tests`, async (context) => success(context, await listCampaignMessageTests(uuid.parse(context.params.campaignId))), { capability: "outreach.campaign.manage" });
  router.add("GET", `${API}/message-test-contacts`, async (context) => success(context, await searchMessageTestContacts(context.url.searchParams.get("search") ?? "")), { capability: "outreach.campaign.manage" });
  router.add("PATCH", `${API}/campaigns/:campaignId`, async (context) => {
    assertOrigin(context.request);
    success(context, await updateCampaign(actor(context), uuid.parse(context.params.campaignId), await readJson(context.request)));
  }, { capability: "outreach.campaign.manage" });
  router.add("POST", `${API}/campaigns/:campaignId/message-tests`, async (context) => {
    assertOrigin(context.request);
    const currentActor = actor(context);
    requireCapability(currentActor, "outreach.campaign.manage");
    const key = singleHeader(context.request.headers["idempotency-key"]);
    if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new HttpError(400, "idempotency_key_required", "Indica um Idempotency-Key válido para o teste.");
    success(context, await queueCampaignMessageTest(currentActor, uuid.parse(context.params.campaignId), await readJson(context.request), key), 202);
  }, { capability: "outreach.campaign.launch" });
  for (const action of ["launch", "pause", "resume"] as const) {
    router.add("POST", `${API}/campaigns/:campaignId/${action}`, async (context) => {
      assertOrigin(context.request);
      success(context, await campaignAction(actor(context), uuid.parse(context.params.campaignId), action));
    }, { capability: "outreach.campaign.launch" });
  }

  router.add("GET", `${API}/audiences`, async (context) => success(context, await listAudiences(pageParams(context.url), context.url.searchParams.get("search") ?? "")), { capability: "outreach.campaign.manage" });
  router.add("POST", `${API}/audiences`, async (context) => {
    assertOrigin(context.request);
    success(context, await createAudience(actor(context), await readJson(context.request)), 201);
  }, { capability: "outreach.campaign.manage" });
  router.add("GET", `${API}/audiences/eligibility`, async (context) => {
    const ids = (context.url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((id) => uuid.parse(id)).slice(0, 5_000);
    success(context, { items: await contactEligibility(ids) });
  }, { capability: "outreach.campaign.manage" });
  const addAudienceHandler = async (context: import("./router.js").RouteContext) => {
    assertOrigin(context.request);
    success(context, await addAudienceContacts(actor(context), uuid.parse(context.params.audienceId), await readJson(context.request)));
  };
  router.add("POST", `${API}/audiences/:audienceId/recipients`, addAudienceHandler, { capability: "outreach.campaign.manage" });
  router.add("POST", `${API}/audiences/:audienceId/members`, addAudienceHandler, { capability: "outreach.campaign.manage" });

  router.add("GET", `${API}/mailboxes`, async (context) => success(context, { items: await listMailboxes() }), { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes`, async (context) => {
    assertOrigin(context.request);
    success(context, await createMailbox(actor(context), await readJson(context.request)), 201);
  }, { capability: "outreach.mailbox.manage" });
  router.add("PATCH", `${API}/mailboxes/:mailboxId`, async (context) => {
    assertOrigin(context.request);
    success(context, await updateMailbox(actor(context), uuid.parse(context.params.mailboxId), await readJson(context.request)));
  }, { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes/:mailboxId/disconnect`, async (context) => {
    assertOrigin(context.request);
    success(context, await disconnectMailbox(actor(context), uuid.parse(context.params.mailboxId)));
  }, { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes/:mailboxId/ramp`, async (context) => {
    assertOrigin(context.request);
    success(context, await advanceMailboxRamp(actor(context), uuid.parse(context.params.mailboxId)));
  }, { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes/oauth/start`, async (context) => {
    assertOrigin(context.request);
    const input = z.object({ mailboxId: uuid, provider: z.literal("google").default("google"), emailHint: z.email().optional() }).parse(await readJson(context.request));
    const mailbox = await getMailbox(input.mailboxId);
    if (mailbox.provider !== input.provider) throw new HttpError(409, "provider_mismatch", "A mailbox não pertence ao provider pedido.");
    if (input.emailHint && input.emailHint.toLowerCase() !== mailbox.email.toLowerCase()) throw new HttpError(409, "mailbox_email_mismatch", "O email OAuth tem de corresponder à mailbox criada.");
    const verifier = randomToken(48);
    const redirectUri = `${config.publicUrl}${API}/oauth/callback/google`;
    const state = await createOAuthState(actor(context), { mailboxId: input.mailboxId, provider: "google", redirectUri, verifier });
    success(context, { authorizationUrl: buildAuthorizationUrl({ provider: "google", state, verifier, redirectUri, ...(input.emailHint ? { emailHint: input.emailHint } : {}) }) });
  }, { capability: "outreach.mailbox.manage" });
  router.add("GET", `${API}/oauth/callback/:provider`, async (context) => {
    const provider = z.literal("google").parse(context.params.provider);
    const state = context.url.searchParams.get("state");
    if (!state) throw new HttpError(400, "oauth_state_missing", "O estado OAuth está em falta.");
    const pending = await consumeOAuthState(state, provider);
    const error = context.url.searchParams.get("error_description") ?? context.url.searchParams.get("error");
    const code = context.url.searchParams.get("code");
    const target = new URL("/outreach/mailboxes", config.frontendUrl);
    if (error || !code) {
      target.searchParams.set("oauth_error", error ?? "Código OAuth em falta.");
      context.response.writeHead(302, { location: target.toString() });
      context.response.end();
      return;
    }
    let issuedCredential: Awaited<ReturnType<typeof exchangeAuthorizationCode>> | null = null;
    try {
      await assertOAuthCallbackAuthorized(pending.mailboxId, pending.profileId, pending.oauthStateHash);
      await prepareMailboxReauthorization(pending.mailboxId, pending.profileId, pending.oauthStateHash);
      // Reauthorization must retire the previous grant. This occurs before
      // exchanging the fresh code so revocation cannot invalidate the newly
      // persisted credential.
      await revokeMailboxAuthorizationBestEffort(pending.mailboxId);
      await deleteMailboxCredential(pending.mailboxId);
      issuedCredential = await exchangeAuthorizationCode({ provider, code, verifier: pending.verifier, redirectUri: pending.redirectUri });
      const identity = await fetchOAuthIdentity(provider, issuedCredential.accessToken);
      const mailbox = await getMailbox(pending.mailboxId);
      if (mailbox.email.toLowerCase() !== identity.email.toLowerCase()) throw new HttpError(409, "oauth_identity_mismatch", "A conta Google escolhida não corresponde à mailbox configurada.");
      await markMailboxConnected(pending.mailboxId, identity, issuedCredential, pending.profileId, pending.oauthStateHash);
      target.searchParams.set("oauth", "connected");
    } catch (oauthError) {
      if (issuedCredential) {
        try {
          await revokeProviderAuthorization({ provider, credentials: issuedCredential, persist: async () => undefined });
        } catch {
          // The temporary credential is never persisted; provider revocation
          // remains best-effort and no secret enters logs or redirect params.
        }
      }
      target.searchParams.set("oauth_error", oauthError instanceof Error ? oauthError.message : "Falha OAuth.");
    }
    context.response.writeHead(302, { location: target.toString() });
    context.response.end();
  }, { public: true });
  router.add("POST", `${API}/mailboxes/:mailboxId/test`, async (context) => {
    assertOrigin(context.request);
    const mailboxId = uuid.parse(context.params.mailboxId);
    success(context, await testProvider(await providerSession(mailboxId)));
  }, { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes/:mailboxId/dns`, async (context) => {
    assertOrigin(context.request);
    const input = z.object({ selector: z.string().max(80).default("google") }).parse(await readJson(context.request));
    success(context, await recordDnsCheck(actor(context), uuid.parse(context.params.mailboxId), input.selector));
  }, { capability: "outreach.mailbox.manage" });
  router.add("POST", `${API}/mailboxes/:mailboxId/sync`, async (context) => {
    assertOrigin(context.request);
    success(context, await syncMailbox(uuid.parse(context.params.mailboxId)));
  }, { capability: "outreach.mailbox.manage" });

  router.add("POST", `${API}/verifications`, async (context) => {
    assertOrigin(context.request);
    success(context, await verifyContacts(actor(context), await readJson(context.request)));
  }, { capability: "outreach.campaign.manage" });
  router.add("POST", `${API}/verifications/evidence`, async (context) => {
    assertOrigin(context.request);
    success(context, await recordEmailVerificationEvidence(actor(context), await readJson(context.request)), 201);
  }, { capability: "outreach.admin" });

  router.add("GET", `${API}/threads`, async (context) => success(context, await listThreads(actor(context), pageParams(context.url), context.url.searchParams.get("status") ?? "open")), { capability: "outreach.thread.handle" });
  router.add("GET", `${API}/threads/:threadId`, async (context) => success(context, await getThread(actor(context), uuid.parse(context.params.threadId))), { capability: "outreach.thread.handle" });
  for (const action of ["classify", "archive"] as const) {
    router.add("POST", `${API}/threads/:threadId/${action}`, async (context) => {
      assertOrigin(context.request);
      success(context, await updateThread(actor(context), uuid.parse(context.params.threadId), action, await readJson(context.request)));
    }, { capability: "outreach.thread.handle" });
  }
  router.add("POST", `${API}/threads/:threadId/assign`, async (context) => {
    assertOrigin(context.request);
    success(context, await updateThread(actor(context), uuid.parse(context.params.threadId), "assign", await readJson(context.request)));
  }, { capability: "outreach.thread.assign" });
  router.add("POST", `${API}/threads/:threadId/reply`, async (context) => {
    assertOrigin(context.request);
    const input = z.object({ subject: z.string().max(998).optional(), body: z.string().trim().min(1).max(200_000) }).parse(await readJson(context.request));
    const key = singleHeader(context.request.headers["idempotency-key"]);
    if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new HttpError(400, "idempotency_key_required", "Indica um Idempotency-Key válido para enviar a resposta.");
    const current = actor(context);
    success(context, await sendThreadReply({ threadId: uuid.parse(context.params.threadId), actorId: current.id, canHandleAny: current.crmRole === "admin" || current.outreachRole === "campaign_manager", ...(input.subject ? { subject: input.subject } : {}), body: input.body, idempotencyKey: key }));
  }, { capability: "outreach.thread.handle" });

  router.add("GET", `${API}/suppressions`, async (context) => success(context, await listSuppressions(pageParams(context.url))), { capability: "outreach.suppression.manage" });
  router.add("POST", `${API}/suppressions`, async (context) => {
    assertOrigin(context.request);
    success(context, await createSuppression(actor(context), await readJson(context.request), "api"), 201);
  }, { capability: "outreach.suppression.manage" });
  router.add("DELETE", `${API}/suppressions/:suppressionId`, async (context) => {
    assertOrigin(context.request);
    success(context, await deactivateSuppression(actor(context), uuid.parse(context.params.suppressionId)));
  }, { capability: "outreach.suppression.manage" });

  router.add("GET", `${API}/audit`, async (context) => success(context, await listAudit(pageParams(context.url))), { capability: "outreach.admin" });
  router.add("GET", `${API}/inbound-reconciliation`, async (context) => {
    const status = z.enum(["reconciliation_required", "resolved", "ignored"])
      .catch("reconciliation_required")
      .parse(context.url.searchParams.get("status") ?? "reconciliation_required");
    success(context, await listInboundReconciliation(pageParams(context.url), status));
  }, { capability: "outreach.admin" });
  router.add("POST", `${API}/inbound-reconciliation/:reconciliationId/ignore`, async (context) => {
    assertOrigin(context.request);
    success(context, await ignoreInboundReconciliation(actor(context), uuid.parse(context.params.reconciliationId)));
  }, { capability: "outreach.admin" });
  router.add("POST", `${API}/jobs/:jobId/adjudicate`, async (context) => {
    assertOrigin(context.request);
    success(context, await adjudicateJobReconciliation(
      actor(context),
      uuid.parse(context.params.jobId),
      await readJson(context.request),
    ));
  }, { capability: "outreach.admin" });
  router.add("GET", `${API}/job-reconciliation`, async (context) => {
    success(context, await listJobReconciliation(pageParams(context.url)));
  }, { capability: "outreach.admin" });
  router.add("GET", `${API}/settings`, async (context) => success(context, await settings(actor(context))), { capability: "outreach.read" });
  router.add("PATCH", `${API}/settings`, async (context) => {
    assertOrigin(context.request);
    const currentActor = actor(context);
    await updateSystemSettings(currentActor, await readJson(context.request));
    success(context, await settings(currentActor));
  }, { capability: "outreach.admin" });

  router.add("POST", `${API}/webhooks/google`, async (context) => {
    const token = context.url.searchParams.get("token") ?? singleHeader(context.request.headers["x-goog-channel-token"]);
    if (!config.google.pubsubVerificationToken || !token || !safeEqual(token, config.google.pubsubVerificationToken)) throw new HttpError(401, "webhook_signature_invalid", "Webhook Google não autenticado.");
    const raw = await readRaw(context.request);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new HttpError(400, "invalid_json", "Webhook Google com JSON inválido."); }
    const parsed = z.object({ message: z.object({ messageId: z.string().min(1), data: z.string().optional() }) }).parse(payload);
    success(context, await storeWebhook("google", parsed.message.messageId, raw, true), 202);
  }, { public: true });
  router.add("POST", `${API}/webhooks/:provider`, async (context) => {
    const provider = z.enum(["google", "microsoft", "smtp_imap"]).parse(context.params.provider);
    const raw = await readRaw(context.request);
    const signature = singleHeader(context.request.headers["x-outreach-signature"]);
    if (!verifyHmac(raw, signature)) throw new HttpError(401, "webhook_signature_invalid", "Assinatura do webhook inválida.");
    const eventId = singleHeader(context.request.headers["x-provider-event-id"]) ?? sha256(raw).toString("hex");
    success(context, await storeWebhook(provider, eventId, raw, true), 202);
  }, { public: true });

  router.add("GET", `${API}/unsubscribe/:token`, async (context) => {
    const token = context.params.token ?? "";
    const exists = await pool.query(`select 1 from private.outreach_unsubscribe_tokens where token_hash=$1 and used_at is null and (expires_at is null or expires_at>now())`, [sha256(token)]);
    if (!exists.rows[0]) throw new HttpError(404, "unsubscribe_invalid", "Este link expirou ou já foi utilizado.");
    html(context.response, 200, `<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cancelar comunicações</title><style>body{font:16px system-ui;background:#0a0a0a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:34rem;padding:2rem}button{min-height:44px;padding:.7rem 1rem}</style><main><h1>Cancelar comunicações</h1><p>Confirma que não queres receber mais emails comerciais da Nikufra.</p><form method="post"><button name="List-Unsubscribe" value="One-Click">Confirmar</button></form></main></html>`);
  }, { public: true });
  router.add("POST", `${API}/unsubscribe/:token`, async (context) => {
    const token = context.params.token ?? "";
    const result = await transaction(async (client) => {
      const tokenResult = await client.query<{ recipient_id: string; used_at: Date | null; expires_at: Date | null }>(`select recipient_id,used_at,expires_at from private.outreach_unsubscribe_tokens where token_hash=$1 for update`, [sha256(token)]);
      const stored = tokenResult.rows[0];
      if (!stored || (stored.expires_at && stored.expires_at <= new Date())) throw new HttpError(404, "unsubscribe_invalid", "Este link expirou ou é inválido.");
      if (stored.used_at) return { alreadyUnsubscribed: true };
      const recipient = await client.query<{ email: string }>(`select email_snapshot::text email from public.outreach_recipients where id=$1`, [stored.recipient_id]);
      if (!recipient.rows[0]?.email) throw new HttpError(404, "unsubscribe_identity_missing", "O destinatário já foi eliminado.");
      await createSuppressionWithClient(client, null, { scope: "email", email: recipient.rows[0].email, reason: "unsubscribe", note: "RFC 8058 one-click" }, "unsubscribe");
      await client.query(`update private.outreach_unsubscribe_tokens set used_at=now() where token_hash=$1`, [sha256(token)]);
      return { alreadyUnsubscribed: false };
    }, "serializable");
    success(context, { unsubscribed: true, ...result });
  }, { public: true });

  router.add("POST", `${API}/internal/process-webhooks`, async (context) => {
    requireCapability(actor(context), "outreach.admin");
    success(context, await processWebhookEvents());
  }, { capability: "outreach.admin" });

  return router;
}
