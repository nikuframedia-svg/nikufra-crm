import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];

function assetNameFromUrl(value) {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
  if (!name || basename(name) !== name) throw new Error(`URL de artefacto inválido: ${value}`);
  return name;
}

function publicAssetUrl(baseUrl, name) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(encodeURIComponent(name), normalizedBase).toString();
}

async function assertFile(path, label) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.size === 0) throw new Error(`${label} ausente ou vazio: ${path}`);
  return metadata.size;
}

function selectSingle(files, pattern, label) {
  const matches = files.filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error(`Esperava exatamente um instalador ${label}; encontrei ${matches.length}`);
  return matches[0];
}

export async function prepareUpdaterPayload({ releaseDir, payloadDir, baseUrl, expectedVersion, releaseTrust = "production" }) {
  if (new URL(baseUrl).protocol !== "https:") throw new Error("O canal de updates tem de usar HTTPS");
  if (!["production", "internal"].includes(releaseTrust)) throw new Error(`Nível de confiança inválido: ${releaseTrust}`);

  const sourceManifest = JSON.parse(await readFile(join(releaseDir, "latest.json"), "utf8"));
  if (sourceManifest.version !== expectedVersion) {
    throw new Error(`Versão do manifesto (${sourceManifest.version}) não corresponde ao package (${expectedVersion})`);
  }
  if (!sourceManifest.platforms || typeof sourceManifest.platforms !== "object") {
    throw new Error("Manifesto sem plataformas");
  }

  const releaseFiles = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "latest.json")
    .map((entry) => entry.name);

  for (const platform of REQUIRED_PLATFORMS) {
    const entry = sourceManifest.platforms[platform];
    if (!entry?.url || !entry?.signature) throw new Error(`Manifesto incompleto para ${platform}`);
    const assetName = assetNameFromUrl(entry.url);
    await assertFile(join(releaseDir, assetName), `Artefacto de update ${platform}`);
  }

  const macInstaller = selectSingle(releaseFiles, /\.dmg$/i, "macOS");
  const windowsInstaller = selectSingle(releaseFiles, /\.exe$/i, "Windows");
  const assetsDir = join(payloadDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  await Promise.all(releaseFiles.map((name) => copyFile(join(releaseDir, name), join(assetsDir, name))));

  const stableInstallers = {
    macos: { source: macInstaller, name: "Nikufra-CRM-macOS.dmg" },
    windows: { source: windowsInstaller, name: "Nikufra-CRM-Windows.exe" },
  };
  await Promise.all(Object.values(stableInstallers).map(({ source, name }) => (
    copyFile(join(releaseDir, source), join(assetsDir, name))
  )));

  const manifest = structuredClone(sourceManifest);
  for (const entry of Object.values(manifest.platforms)) {
    entry.url = publicAssetUrl(baseUrl, assetNameFromUrl(entry.url));
  }
  await writeFile(join(payloadDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const downloads = {
    version: expectedVersion,
    trust: {
      updaterSigned: true,
      macosNotarized: releaseTrust === "production",
      windowsAuthenticode: releaseTrust === "production",
    },
    macos: {
      url: publicAssetUrl(baseUrl, stableInstallers.macos.name),
      bytes: await assertFile(join(assetsDir, stableInstallers.macos.name), "Instalador macOS"),
    },
    windows: {
      url: publicAssetUrl(baseUrl, stableInstallers.windows.name),
      bytes: await assertFile(join(assetsDir, stableInstallers.windows.name), "Instalador Windows"),
    },
  };
  await writeFile(join(payloadDir, "downloads.json"), `${JSON.stringify(downloads, null, 2)}\n`);
  return { manifest, downloads };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [releaseDir, payloadDir, baseUrl, expectedVersion, releaseTrust = "production"] = process.argv.slice(2);
  if (!releaseDir || !payloadDir || !baseUrl || !expectedVersion) {
    throw new Error("Uso: prepare-updater-payload.mjs <release> <payload> <base-url> <versão> [production|internal]");
  }
  await prepareUpdaterPayload({ releaseDir, payloadDir, baseUrl, expectedVersion, releaseTrust });
}
