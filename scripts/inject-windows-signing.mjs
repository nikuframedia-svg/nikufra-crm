import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function safeName(value, label) {
  if (!/^[A-Za-z0-9._-]+$/.test(value ?? "")) {
    throw new Error(`${label} contém caracteres não permitidos.`);
  }
  return value;
}

export function windowsSignCommand({ endpoint, account, profile }) {
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("AZURE_ARTIFACT_SIGNING_ENDPOINT não é um URL válido.");
  }
  if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
    throw new Error("O endpoint Azure de assinatura tem de ser um URL HTTPS simples.");
  }
  const normalizedEndpoint = parsedEndpoint.toString().replace(/\/$/, "");
  return `artifact-signing-cli -e ${normalizedEndpoint} -a ${safeName(account, "Conta Azure")} -c ${safeName(profile, "Perfil Azure")} -d "Nikufra CRM" %1`;
}

export async function injectWindowsSigning(configPath, options) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.bundle ??= {};
  config.bundle.windows ??= {};
  config.bundle.windows.signCommand = windowsSignCommand(options);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config.bundle.windows.signCommand;
}

async function main() {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await injectWindowsSigning(resolve(rootDirectory, "src-tauri", "tauri.conf.json"), {
    endpoint: process.env.AZURE_ARTIFACT_SIGNING_ENDPOINT,
    account: process.env.AZURE_ARTIFACT_SIGNING_ACCOUNT,
    profile: process.env.AZURE_ARTIFACT_SIGNING_PROFILE,
  });
  console.log("Comando Azure Artifact Signing injetado na configuração temporária da release.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
