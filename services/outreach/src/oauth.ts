import { config } from "./config.js";
import { pkceChallenge } from "./crypto.js";
import { HttpError } from "./errors.js";
import type { OAuthCredential, Provider } from "./types.js";

function settings(provider: Exclude<Provider, "smtp">) {
  if (provider === "google") {
    return {
      enabled: config.google.enabled,
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
    };
  }
  const tenant = encodeURIComponent(config.microsoft.tenant);
  return {
    enabled: config.microsoft.enabled,
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send", "Mail.ReadWrite"],
  };
}

export function providerConfiguration() {
  return { google: config.google.enabled, microsoft: config.microsoft.enabled, smtp: config.smtpEnabled };
}

export function buildAuthorizationUrl(input: { provider: Exclude<Provider, "smtp">; state: string; verifier: string; redirectUri: string; emailHint?: string }) {
  const provider = settings(input.provider);
  if (!provider.enabled) throw new HttpError(503, "provider_disabled", "Este provider ainda não está ativo no rollout.");
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", pkceChallenge(input.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (input.emailHint) url.searchParams.set("login_hint", input.emailHint);
  if (input.provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  } else {
    url.searchParams.set("response_mode", "query");
  }
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(providerName: Exclude<Provider, "smtp">, params: URLSearchParams) {
  const provider = settings(providerName);
  if (!provider.enabled) throw new HttpError(503, "provider_disabled", "Este provider ainda não está ativo no rollout.");
  params.set("client_id", provider.clientId);
  if (provider.clientSecret) params.set("client_secret", provider.clientSecret);
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const payload = await response.json() as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new HttpError(502, "oauth_token_rejected", payload.error_description || payload.error || "O provider recusou a troca OAuth.");
  }
  return payload;
}

export async function exchangeAuthorizationCode(input: { provider: Exclude<Provider, "smtp">; code: string; verifier: string; redirectUri: string }) {
  const token = await requestToken(input.provider, new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  }));
  if (!token.refresh_token) throw new HttpError(502, "oauth_refresh_missing", "O provider não devolveu refresh token. Revoga o consentimento e volta a ligar a conta.");
  return {
    kind: "oauth",
    accessToken: token.access_token!,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? "",
    tokenType: token.token_type ?? "Bearer",
  } satisfies OAuthCredential;
}

export async function refreshOAuthCredential(provider: Exclude<Provider, "smtp">, credential: OAuthCredential) {
  if (credential.expiresAt > Date.now() + 120_000) return credential;
  const token = await requestToken(provider, new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refreshToken }));
  return {
    ...credential,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token ?? credential.refreshToken,
    expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? credential.scope,
    tokenType: token.token_type ?? credential.tokenType,
  } satisfies OAuthCredential;
}

export async function fetchOAuthIdentity(provider: Exclude<Provider, "smtp">, accessToken: string) {
  const url = provider === "google"
    ? "https://www.googleapis.com/oauth2/v2/userinfo"
    : "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName";
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json() as { email?: string; name?: string; mail?: string; userPrincipalName?: string; displayName?: string; error?: { message?: string } };
  if (!response.ok) throw new HttpError(502, "provider_identity_failed", payload.error?.message ?? "Não foi possível ler a identidade da mailbox.");
  const email = payload.email ?? payload.mail ?? payload.userPrincipalName;
  if (!email) throw new HttpError(502, "provider_identity_missing", "O provider não devolveu o endereço da mailbox.");
  return { email: email.toLowerCase(), name: payload.name ?? payload.displayName ?? email };
}
