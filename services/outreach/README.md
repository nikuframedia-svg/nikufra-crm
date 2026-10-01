# Nikufra Outreach service

Private API and worker for the CRM Outreach module. The browser never connects
to the Outreach database tables directly. Both processes use the same image:

```sh
node dist/api.js       # port 8787
node dist/worker.js    # health port 8788
```

The API exposes loopback probes at `/healthz` and `/readyz`, plus the public
reverse-proxy probe `/api/outreach/v1/healthz`; business routes under
`/api/outreach/v1` remain authenticated. The worker exposes `/healthz`. A
database-ready response is required before traffic is sent to the API.

## Safe rollout defaults

- `OUTREACH_SEND_ENABLED=false` is the independent environment kill switch.
- `OUTREACH_SHADOW_MODE=true` evaluates due-job eligibility without leasing,
  dispatching, creating delivery ledgers/tokens, or changing campaign/job state.
- `OUTREACH_ADMIN_ONLY=true` restricts the module to active CRM admins during
  dark deploy.
- The database starts in `disabled`; the only valid rollout path is
  `disabled -> canary -> live`. Live requires the literal confirmation
  `ACTIVATE_LIVE` and the environment gate.
- Google is the only enabled provider. Microsoft and SMTP/IMAP remain behind
  disabled feature flags.
- New mailboxes have `send_enabled=false`; activation requires active Google
  OAuth credentials, current passing SPF/DKIM/DMARC/MX, and a daily limit of 1.
  Ramp levels are 1, 3, 5, and 10 with at least 48 hours between increases.
- Open and click tracking are intentionally unavailable.

## Required environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL for the least-privileged `outreach_service` login |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Internal GoTrue user validation |
| `OUTREACH_PUBLIC_URL` | Public HTTPS origin used by OAuth and unsubscribe links |
| `OUTREACH_FRONTEND_URL` | CRM origin used after OAuth callbacks |
| `OUTREACH_CORS_ORIGINS` | Comma-separated exact CRM origins |
| `OUTREACH_ENCRYPTION_KEYS` | `version:base64` AES-256 keys, comma-separated |
| `OUTREACH_ACTIVE_KEY_VERSION` | Key version for all new/rotated ciphertext |
| `OUTREACH_HMAC_SECRET` | At least 32 bytes for signed public flows |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Dedicated campaign-mailbox OAuth client |
| `GOOGLE_PUBSUB_VERIFICATION_TOKEN` | Exact token required by the Google webhook |

No credential, OAuth state, webhook secret, or unsubscribe token from the old
standalone app is accepted by the importer.

## API contract

Successful responses use `{ "data": ... }`; errors use
`{ "error": { "code", "message", "requestId" } }`.

- overview and metrics: `GET /overview`, `GET /metrics`
- campaigns: list/create/detail/update plus `launch`, `pause`, `resume`
- audiences: list/create, eligibility, members/recipients
- mailboxes: list/create/update, OAuth start/callback, test, DNS, inbound sync
- verification: `POST /verifications`
- inbox: list/detail, reply, classify, archive, assign
- suppressions and audit: list/create/deactivate and audit list
- settings: operational guardrails, system state, and Outreach roles
- public protected routes: OAuth callback, signed webhooks, tokenized RFC 8058
  unsubscribe

Every private request validates the Supabase access token with GoTrue, then
loads an active CRM profile and its capability set. There is no workspace
header or second tenant/login.

## Operations

```sh
npm run build
npm test

# Defaults to a read-only dry run. --apply is explicit.
node dist/migrate.js --input /secure/path/legacy-state.json --dry-run
node dist/migrate.js --input /secure/path/legacy-state.json --apply

# Defaults to dry run. Keep old and new keys configured until this succeeds.
node dist/rotate-keys.js
node dist/rotate-keys.js --apply
```

Migration is idempotent through legacy IDs and the snapshot hash recorded by
the database. Imported mailboxes are disconnected/send-disabled, campaigns are
paused, and ambiguous jobs require reconciliation.

An ambiguous provider response is never blindly retried. The worker records it
as `reconciliation_required` and searches Gmail Sent by the deterministic
RFC822 Message-ID before finalizing. Expired leases with a delivery ledger also
go to reconciliation; only leases with no dispatch ledger return to pending.

Jobs that cannot be resolved automatically stay blocked. After at least two
provider searches return no match, an active CRM administrator may close one
listed by `GET /api/outreach/v1/job-reconciliation` through
`POST /api/outreach/v1/jobs/:jobId/adjudicate` with outcome
`cancelled`, a concrete reason, and an external evidence reference. A
`confirmed_sent` outcome additionally requires a provider message ID already
stored as an outbound message for the same mailbox, campaign, and recipient.
The database stores the evidence reference privately, hashes it into the audit
log, closes any ledger as reconciled/confirmed, and never returns the job to
pending. Legacy jobs without a dispatch ledger use the same endpoint; exact
legacy provider-message matches are finalized as sent during import instead.

## Verification

The service tests cover auth/capabilities, bounded requests and rate limiting,
AES-GCM rotation, OAuth refresh/revocation, transient provider failures,
two-worker leasing, ambiguous delivery recovery, webhook replay, SSRF denial,
unsubscribe-safe MIME, mailbox ramp gates, shadow mode with zero mutation, and
a deterministic 3,048-job batch.
