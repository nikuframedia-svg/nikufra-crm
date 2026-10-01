import { createClient } from "@supabase/supabase-js";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new Error("Sessão em falta");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sessão inválida");
  return data.user;
}

export async function activeUser(request: Request) {
  const user = await authenticatedUser(request);
  const { data: profile, error } = await adminClient().from("profiles").select("id,role,ativo").eq("id", user.id).single();
  if (error || !profile?.ativo) throw new Error("Conta ainda não aprovada");
  return { user, profile };
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function tokenKey() {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY em falta");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(token));
  return `${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptToken(value: string) {
  const [iv, cipher] = value.split(":");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await tokenKey(), base64ToBytes(cipher));
  return new TextDecoder().decode(plain);
}

export async function gmailAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth não está configurado no servidor");

  let lastError = "resposta desconhecida";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "erro de rede";
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
        continue;
      }
      throw new Error(`Google token refresh indisponível após 3 tentativas (${lastError})`);
    }

    const payload = await response.json().catch(() => ({})) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (response.ok && payload.access_token) return payload.access_token;

    lastError = payload.error_description || payload.error || `HTTP ${response.status}`;
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 2) {
      const kind = transient ? "indisponível após 3 tentativas" : "recusado; volta a autorizar a conta se o acesso foi revogado";
      throw new Error(`Google token refresh ${kind} (${response.status}: ${lastError})`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 5_000)
      : 250 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Google token refresh falhou (${lastError})`);
}
