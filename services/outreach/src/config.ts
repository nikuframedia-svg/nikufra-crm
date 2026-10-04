import { z } from "zod";

const booleanValue = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalUrl = z.union([z.literal(""), z.url()]);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  OUTREACH_WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  OUTREACH_PUBLIC_URL: z.url(),
  OUTREACH_FRONTEND_URL: z.url(),
  OUTREACH_CORS_ORIGINS: z.string().min(1),
  OUTREACH_SEND_ENABLED: booleanValue.default(false),
  OUTREACH_SHADOW_MODE: booleanValue.default(true),
  OUTREACH_INBOUND_ENABLED: booleanValue.default(true),
  OUTREACH_ADMIN_ONLY: booleanValue.default(true),
  OUTREACH_ENCRYPTION_KEYS: z.string().default(""),
  OUTREACH_ACTIVE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  OUTREACH_HMAC_SECRET: z.string().default(""),
  OUTREACH_WEBHOOK_SECRET: z.string().default(""),
  OUTREACH_UNSUBSCRIBE_SECRET: z.string().default(""),
  OUTREACH_DB_POOL_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  OUTREACH_WORKER_ID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/).default("outreach-worker"),
  OUTREACH_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(15),
  OUTREACH_INBOUND_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(86400).default(60),
  OUTREACH_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
  OUTREACH_MAX_JITTER_SECONDS: z.coerce.number().int().min(0).max(3600).default(90),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().default(""),
  MICROSOFT_CLIENT_ID: z.string().default(""),
  MICROSOFT_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_TENANT: z.string().default("common"),
  OUTREACH_ENABLE_MICROSOFT: booleanValue.default(false),
  OUTREACH_ENABLE_SMTP: booleanValue.default(false),
  OUTREACH_INSTANTLY_API_KEY: z.string().default(""),
  OUTREACH_INSTANTLY_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(25),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl.default(""),
});

export interface EncryptionKey {
  version: number;
  value: Buffer;
}

function parseEncryptionKeys(raw: string) {
  if (!raw.trim()) return new Map<number, Buffer>();
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) throw new Error("OUTREACH_ENCRYPTION_KEYS deve usar o formato versão:base64.");
    const version = Number(entry.slice(0, separator));
    const value = Buffer.from(entry.slice(separator + 1), "base64");
    if (!Number.isInteger(version) || version < 1 || value.length !== 32) {
      throw new Error("Cada chave Outreach tem de ter uma versão positiva e exatamente 32 bytes em base64.");
    }
    if (keys.has(version)) throw new Error(`A versão de chave ${version} está repetida.`);
    keys.set(version, value);
  }
  return keys;
}

const testDefaults = process.env.VITEST === "true" || process.env.NODE_ENV === "test" ? {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://outreach:outreach@127.0.0.1:5432/outreach_test",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "test-anon-key",
  OUTREACH_PUBLIC_URL: "https://crm.nikufra.ai",
  OUTREACH_FRONTEND_URL: "https://crm.nikufra.ai",
  OUTREACH_CORS_ORIGINS: "https://crm.nikufra.ai",
  OUTREACH_SEND_ENABLED: "false",
  OUTREACH_ENCRYPTION_KEYS: "1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=,2:AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
  OUTREACH_ACTIVE_KEY_VERSION: "2",
  OUTREACH_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
  OUTREACH_WEBHOOK_SECRET: "webhook-0123456789abcdef0123456789abcdef",
  OUTREACH_UNSUBSCRIBE_SECRET: "unsubscribe-0123456789abcdef0123456789abcdef",
} : {};

const parsed = schema.safeParse({ ...testDefaults, ...process.env });
if (!parsed.success) {
  throw new Error(`Configuração Outreach inválida: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}

const data = parsed.data;
const encryptionKeys = parseEncryptionKeys(data.OUTREACH_ENCRYPTION_KEYS);
// These code paths remain available for provider-specific development, but a
// deploy-time flag alone must not expose an uncertified transport. Flip a
// certification gate only together with its provider contract tests.
const certifiedProviders = { microsoft: false, smtp: false } as const;
if (data.OUTREACH_SEND_ENABLED) {
  if (data.NODE_ENV !== "production") throw new Error("Envio real só pode ser ativado em NODE_ENV=production.");
  if (!encryptionKeys.has(data.OUTREACH_ACTIVE_KEY_VERSION)) throw new Error("A chave de encriptação ativa não está configurada.");
  if (Buffer.byteLength(data.OUTREACH_HMAC_SECRET) < 32) throw new Error("OUTREACH_HMAC_SECRET tem de ter pelo menos 32 bytes.");
  if (Buffer.byteLength(data.OUTREACH_UNSUBSCRIBE_SECRET) < 32) throw new Error("OUTREACH_UNSUBSCRIBE_SECRET tem de ter pelo menos 32 bytes.");
  const publicUrl = new URL(data.OUTREACH_PUBLIC_URL);
  if (publicUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname)) {
    throw new Error("OUTREACH_PUBLIC_URL tem de ser HTTPS público para permitir envios.");
  }
}

export const config = {
  nodeEnv: data.NODE_ENV,
  port: data.SERVER_PORT,
  workerHealthPort: data.OUTREACH_WORKER_HEALTH_PORT,
  databaseUrl: data.DATABASE_URL,
  supabaseUrl: data.SUPABASE_URL.replace(/\/$/, ""),
  supabaseAnonKey: data.SUPABASE_ANON_KEY,
  publicUrl: data.OUTREACH_PUBLIC_URL.replace(/\/$/, ""),
  frontendUrl: data.OUTREACH_FRONTEND_URL.replace(/\/$/, ""),
  corsOrigins: new Set(data.OUTREACH_CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)),
  outboundEnvEnabled: data.OUTREACH_SEND_ENABLED,
  shadowMode: data.OUTREACH_SHADOW_MODE,
  inboundEnabled: data.OUTREACH_INBOUND_ENABLED,
  adminOnly: data.OUTREACH_ADMIN_ONLY,
  encryptionKeys,
  activeKeyVersion: data.OUTREACH_ACTIVE_KEY_VERSION,
  hmacSecret: data.OUTREACH_HMAC_SECRET,
  webhookSecret: data.OUTREACH_WEBHOOK_SECRET,
  unsubscribeSecret: data.OUTREACH_UNSUBSCRIBE_SECRET,
  databasePoolSize: data.OUTREACH_DB_POOL_SIZE,
  workerId: data.OUTREACH_WORKER_ID,
  schedulerIntervalMs: data.OUTREACH_SCHEDULER_INTERVAL_SECONDS * 1000,
  inboundIntervalMs: data.OUTREACH_INBOUND_INTERVAL_SECONDS * 1000,
  leaseSeconds: data.OUTREACH_LEASE_SECONDS,
  maxJitterSeconds: data.OUTREACH_MAX_JITTER_SECONDS,
  google: {
    clientId: data.GOOGLE_CLIENT_ID,
    clientSecret: data.GOOGLE_CLIENT_SECRET,
    pubsubVerificationToken: data.GOOGLE_PUBSUB_VERIFICATION_TOKEN,
    enabled: Boolean(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
  },
  microsoft: {
    clientId: data.MICROSOFT_CLIENT_ID,
    clientSecret: data.MICROSOFT_CLIENT_SECRET,
    tenant: data.MICROSOFT_TENANT,
    requested: data.OUTREACH_ENABLE_MICROSOFT,
    enabled: certifiedProviders.microsoft && data.OUTREACH_ENABLE_MICROSOFT && Boolean(data.MICROSOFT_CLIENT_ID),
  },
  smtpRequested: data.OUTREACH_ENABLE_SMTP,
  smtpEnabled: certifiedProviders.smtp && data.OUTREACH_ENABLE_SMTP,
  instantlyApiKey: data.OUTREACH_INSTANTLY_API_KEY,
  instantlyDailyLimit: data.OUTREACH_INSTANTLY_DAILY_LIMIT,
} as const;
