import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(version) {
  const match = stableVersionPattern.exec(version);
  if (!match) throw new Error(`Versão inválida: ${version}. Usa o formato X.Y.Z sem prefixo v.`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function cargoManifestVersion(source) {
  const match = /^\[package\]\n(?:.*\n)*?version\s*=\s*"([^"]+)"/m.exec(source);
  if (!match) throw new Error("Não foi possível ler a versão de src-tauri/Cargo.toml");
  return match[1];
}

function cargoLockVersion(source) {
  const match = /\[\[package\]\]\nname = "nikufra-crm"\nversion = "([^"]+)"/.exec(source);
  if (!match) throw new Error("Não foi possível ler a versão do pacote nikufra-crm em Cargo.lock");
  return match[1];
}

export async function readProjectVersions(rootDirectory) {
  const [packageSource, tauriSource, cargoSource, lockSource] = await Promise.all([
    readFile(join(rootDirectory, "package.json"), "utf8"),
    readFile(join(rootDirectory, "src-tauri", "tauri.conf.json"), "utf8"),
    readFile(join(rootDirectory, "src-tauri", "Cargo.toml"), "utf8"),
    readFile(join(rootDirectory, "src-tauri", "Cargo.lock"), "utf8"),
  ]);
  return {
    packageJson: JSON.parse(packageSource).version,
    tauriConfig: JSON.parse(tauriSource).version,
    cargoManifest: cargoManifestVersion(cargoSource),
    cargoLock: cargoLockVersion(lockSource),
  };
}

export function assertSynchronizedVersions(versions) {
  const entries = Object.entries(versions);
  const expected = entries[0]?.[1];
  const mismatched = entries.filter(([, version]) => version !== expected);
  if (mismatched.length) {
    throw new Error(`Versões desalinhadas: ${entries.map(([file, version]) => `${file}=${version}`).join(", ")}`);
  }
  parseVersion(expected);
  return expected;
}

export async function setProjectVersion(rootDirectory, nextVersion) {
  parseVersion(nextVersion);
  const currentVersion = assertSynchronizedVersions(await readProjectVersions(rootDirectory));
  if (compareVersions(nextVersion, currentVersion) <= 0) {
    throw new Error(`A nova versão (${nextVersion}) tem de ser superior à atual (${currentVersion}).`);
  }

  const paths = {
    packageJson: join(rootDirectory, "package.json"),
    tauriConfig: join(rootDirectory, "src-tauri", "tauri.conf.json"),
    cargoManifest: join(rootDirectory, "src-tauri", "Cargo.toml"),
    cargoLock: join(rootDirectory, "src-tauri", "Cargo.lock"),
  };
  const [packageSource, tauriSource, cargoSource, lockSource] = await Promise.all(
    Object.values(paths).map((path) => readFile(path, "utf8")),
  );
  const packageConfig = JSON.parse(packageSource);
  const tauriConfig = JSON.parse(tauriSource);
  packageConfig.version = nextVersion;
  tauriConfig.version = nextVersion;
  const nextCargoSource = cargoSource.replace(
    /(^\[package\]\n(?:.*\n)*?version\s*=\s*")[^"]+("$)/m,
    `$1${nextVersion}$2`,
  );
  const nextLockSource = lockSource.replace(
    /(\[\[package\]\]\nname = "nikufra-crm"\nversion = ")[^"]+("\n)/,
    `$1${nextVersion}$2`,
  );
  if (nextCargoSource === cargoSource || nextLockSource === lockSource) {
    throw new Error("A atualização da versão Rust não alterou os ficheiros esperados.");
  }
  await Promise.all([
    writeFile(paths.packageJson, `${JSON.stringify(packageConfig, null, 2)}\n`),
    writeFile(paths.tauriConfig, `${JSON.stringify(tauriConfig, null, 2)}\n`),
    writeFile(paths.cargoManifest, nextCargoSource),
    writeFile(paths.cargoLock, nextLockSource),
  ]);
  assertSynchronizedVersions(await readProjectVersions(rootDirectory));
  return { previousVersion: currentVersion, version: nextVersion };
}

async function assertCleanWorktree(rootDirectory) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: rootDirectory });
  if (stdout.trim()) throw new Error("O repositório tem alterações. Faz commit ou guarda-as antes de preparar uma release.");
}

async function main() {
  const nextVersion = process.argv[2];
  if (!nextVersion || process.argv.length !== 3) {
    throw new Error("Uso: pnpm release:prepare <nova-versão>. Exemplo: pnpm release:prepare 0.1.1");
  }
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await assertCleanWorktree(rootDirectory);
  const result = await setProjectVersion(rootDirectory, nextVersion);
  console.log(`Versão preparada: ${result.previousVersion} -> ${result.version}`);
  console.log("Revê as alterações, executa pnpm release:verify e cria o commit da release.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
