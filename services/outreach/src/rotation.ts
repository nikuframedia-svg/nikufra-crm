import { config } from "./config.js";
import { decryptJson, encryptJson, needsReEncryption } from "./crypto.js";
import { transaction } from "./db.js";
import type { ProviderCredential } from "./types.js";

export interface CredentialRow {
  mailbox_id: string;
  encrypted_payload: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

export function rotateCredentialRow(row: CredentialRow) {
  const value = decryptJson<ProviderCredential>({ ciphertext: row.encrypted_payload, nonce: row.nonce, authTag: row.auth_tag, keyVersion: row.key_version }, `outreach-mailbox:${row.mailbox_id}`);
  return encryptJson(value, `outreach-mailbox:${row.mailbox_id}`);
}

interface PackedEnvelope {
  v: number;
  c: string;
  n: string;
  t: string;
}

function packedEnvelope(value: Buffer): PackedEnvelope {
  const parsed = JSON.parse(value.toString("utf8")) as Partial<PackedEnvelope>;
  if (!Number.isInteger(parsed.v) || typeof parsed.c !== "string" || typeof parsed.n !== "string" || typeof parsed.t !== "string") {
    throw new Error("Envelope encriptado inválido.");
  }
  return parsed as PackedEnvelope;
}

export function packedSecretKeyVersion(value: Buffer) {
  return packedEnvelope(value).v;
}

export function rotatePackedSecret(value: Buffer, aad: string) {
  const packed = packedEnvelope(value);
  const cleartext = decryptJson<unknown>({
    keyVersion: packed.v,
    ciphertext: Buffer.from(packed.c, "base64"),
    nonce: Buffer.from(packed.n, "base64"),
    authTag: Buffer.from(packed.t, "base64"),
  }, aad);
  const encrypted = encryptJson(cleartext, aad);
  return Buffer.from(JSON.stringify({
    v: encrypted.keyVersion,
    c: encrypted.ciphertext.toString("base64"),
    n: encrypted.nonce.toString("base64"),
    t: encrypted.authTag.toString("base64"),
  }), "utf8");
}

interface WebhookRow {
  id: string;
  provider: string;
  provider_event_id: string;
  body_encrypted: Buffer;
}

interface InboundRow {
  id: string;
  mailbox_id: string;
  provider_message_id: string;
  payload_encrypted: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
}

interface OAuthStateRow {
  state_hash: Buffer;
  pkce_verifier_encrypted: Buffer | null;
  expires_at: Date | string;
  expired: boolean;
}

export async function rotateCredentialKeys(apply = false) {
  if (!config.encryptionKeys.has(config.activeKeyVersion)) throw new Error("A chave de encriptação ativa não está configurada.");
  return transaction(async (client) => {
    // A pg Client serializes queries anyway; issue the locking reads in one
    // deterministic order so concurrent rotation attempts cannot deadlock.
    const credentials = await client.query<CredentialRow>(`select * from private.outreach_credentials order by mailbox_id for update`);
    const webhooks = await client.query<WebhookRow>(`select id,provider,provider_event_id,body_encrypted from private.outreach_webhook_events order by id for update`);
    const inbound = await client.query<InboundRow>(`select id,mailbox_id,provider_message_id,payload_encrypted,nonce,auth_tag,key_version from private.outreach_inbound_reconciliation order by id for update`);
    const oauthStates = await client.query<OAuthStateRow>(`
      select state_hash,pkce_verifier_encrypted,expires_at,(expires_at<=now()) expired
      from private.outreach_oauth_states order by expires_at,state_hash for update`);
    const pendingCredentials = credentials.rows.filter((row) => needsReEncryption(row.key_version));
    const pendingWebhooks = webhooks.rows.filter((row) => needsReEncryption(packedSecretKeyVersion(row.body_encrypted)));
    const pendingInbound = inbound.rows.filter((row) => needsReEncryption(row.key_version));
    const pendingOAuthStates = oauthStates.rows.filter((row) => row.pkce_verifier_encrypted
      && needsReEncryption(packedSecretKeyVersion(row.pkce_verifier_encrypted)));

    if (apply) {
      for (const row of pendingCredentials) {
        const encrypted = rotateCredentialRow(row);
        await client.query(`update private.outreach_credentials set encrypted_payload=$2,nonce=$3,auth_tag=$4,key_version=$5,updated_at=now() where mailbox_id=$1`, [row.mailbox_id, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion]);
      }
      for (const row of pendingWebhooks) {
        const body = rotatePackedSecret(row.body_encrypted, `webhook:${row.provider}:${row.provider_event_id}`);
        await client.query(`update private.outreach_webhook_events set body_encrypted=$2 where id=$1`, [row.id, body]);
      }
      for (const row of pendingInbound) {
        const cleartext = decryptJson<unknown>({
          ciphertext: row.payload_encrypted,
          nonce: row.nonce,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
        }, `outreach-inbound:${row.mailbox_id}:${row.provider_message_id}`);
        const encrypted = encryptJson(cleartext, `outreach-inbound:${row.mailbox_id}:${row.provider_message_id}`);
        await client.query(`
          update private.outreach_inbound_reconciliation
          set payload_encrypted=$2,nonce=$3,auth_tag=$4,key_version=$5
          where id=$1`, [row.id, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion]);
      }
      // The OAuth state AAD includes the raw state token, while only its hash
      // is persisted. Old-key states therefore cannot be re-encrypted. Mark
      // them used, retain them until their ten-minute expiry as an explicit
      // key-retirement gate, and purge only once the TTL has elapsed.
      for (const row of pendingOAuthStates) {
        await client.query(`update private.outreach_oauth_states set used_at=coalesce(used_at,now()) where state_hash=$1`, [row.state_hash]);
      }
      await client.query(`delete from private.outreach_oauth_states where expires_at<=now()`);
    }

    const oauthRemaining = apply ? pendingOAuthStates.filter((row) => !row.expired) : pendingOAuthStates;
    const remaining = (apply ? 0 : pendingCredentials.length + pendingWebhooks.length + pendingInbound.length) + oauthRemaining.length;
    const safeToRetireAfter = oauthRemaining.length
      ? new Date(Math.max(...oauthRemaining.map((row) => new Date(row.expires_at).getTime()))).toISOString()
      : null;
    return {
      scanned: (credentials.rowCount ?? 0) + (webhooks.rowCount ?? 0) + (inbound.rowCount ?? 0) + (oauthStates.rowCount ?? 0),
      pending: remaining,
      foundPending: pendingCredentials.length + pendingWebhooks.length + pendingInbound.length + pendingOAuthStates.length,
      rotated: apply ? pendingCredentials.length + pendingWebhooks.length + pendingInbound.length : 0,
      invalidatedOAuthStates: apply ? pendingOAuthStates.length : 0,
      activeKeyVersion: config.activeKeyVersion,
      dryRun: !apply,
      retirementReady: remaining === 0,
      safeToRetireAfter,
      stores: {
        credentials: { scanned: credentials.rowCount ?? 0, pending: apply ? 0 : pendingCredentials.length, rotated: apply ? pendingCredentials.length : 0 },
        webhooks: { scanned: webhooks.rowCount ?? 0, pending: apply ? 0 : pendingWebhooks.length, rotated: apply ? pendingWebhooks.length : 0 },
        inboundReconciliation: { scanned: inbound.rowCount ?? 0, pending: apply ? 0 : pendingInbound.length, rotated: apply ? pendingInbound.length : 0 },
        oauthStates: {
          scanned: oauthStates.rowCount ?? 0,
          pending: oauthRemaining.length,
          invalidated: apply ? pendingOAuthStates.length : 0,
          safeToRetireAfter,
        },
      },
    };
  }, "serializable");
}
