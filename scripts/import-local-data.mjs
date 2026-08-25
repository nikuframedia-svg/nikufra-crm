import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signUserToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ aud: "authenticated", exp: now + 3600, iat: now, sub: user.id, email: user.email, role: "authenticated" }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const env = parseEnv(await readFile(resolve("infra/.env"), "utf8"));
const payload = await readFile(resolve("supabase/imports/nikufra_import_payload.json"), "utf8");
const baseUrl = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:8000";
const accountEmail = (process.env.NIKUFRA_ACCOUNT_EMAIL ?? "joao@nikufra.ai").toLowerCase();
const serviceRoleKey = env.SERVICE_ROLE_KEY;
const anonKey = env.ANON_KEY;
const jwtSecret = env.JWT_SECRET;
if (!serviceRoleKey || !anonKey || !jwtSecret) throw new Error("Credenciais locais em infra/.env incompletas.");

const usersResponse = await fetch(`${baseUrl}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` } });
if (!usersResponse.ok) throw new Error(`Não foi possível consultar os utilizadores locais (${usersResponse.status}).`);
const usersPayload = await usersResponse.json();
const user = usersPayload.users?.find((candidate) => candidate.email?.toLowerCase() === accountEmail);
if (!user) throw new Error(`A conta ${accountEmail} ainda não existe na autenticação local.`);

const response = await fetch(`${baseUrl}/functions/v1/import-leads`, {
  method: "POST",
  headers: { apikey: anonKey, authorization: `Bearer ${signUserToken(user, jwtSecret)}`, "content-type": "application/json" },
  body: payload,
});
const result = await response.json();
if (!response.ok) throw new Error(result.error ?? `A importação falhou (${response.status}).`);
console.log(JSON.stringify(result));
