import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertSynchronizedVersions, readProjectVersions } from "./set-version.mjs";

export const requiredReleaseVariables = [
  "TAURI_UPDATER_PUBKEY",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "DEPLOY_HOST",
  "DEPLOY_USER",
  "DEPLOY_SSH_KEY",
  "DEPLOY_KNOWN_HOSTS",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "AZURE_ARTIFACT_SIGNING_PROFILE",
];

export function assertReleaseEnvironment(environment) {
  const missing = requiredReleaseVariables.filter((name) => !environment[name]?.trim());
  if (missing.length) {
    throw new Error(`Release bloqueada: faltam credenciais/configurações: ${missing.join(", ")}`);
  }
}

export async function verifyReleaseState({ rootDirectory, refType, refName, environment, requireExternalCredentials = true }) {
  const version = assertSynchronizedVersions(await readProjectVersions(rootDirectory));
  if (refType || refName) {
    if (refType !== "tag" || refName !== `v${version}`) {
      throw new Error(`A tag da release tem de ser v${version}; recebida ${refType || "sem-tipo"}:${refName || "sem-ref"}.`);
    }
  }
  if (requireExternalCredentials) assertReleaseEnvironment(environment);
  return version;
}

async function main() {
  const localOnly = process.argv.includes("--local");
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const version = await verifyReleaseState({
    rootDirectory,
    refType: localOnly ? "" : process.env.GITHUB_REF_TYPE,
    refName: localOnly ? "" : process.env.GITHUB_REF_NAME,
    environment: process.env,
    requireExternalCredentials: !localOnly,
  });
  console.log(localOnly ? `Versões alinhadas em ${version}.` : `Release v${version} autorizada para compilação assinada.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
