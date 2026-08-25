import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assertSynchronizedVersions,
  classifyReleaseVersion,
  readProjectVersions,
  setProjectVersion,
} from "./set-version.mjs";

const execFileAsync = promisify(execFile);

export const releaseVersionFiles = [
  "package.json",
  "src-tauri/Cargo.lock",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
];

export function parsePublishArguments(argumentsList) {
  const assumeYes = argumentsList.includes("--yes");
  const positional = argumentsList.filter((argument) => argument !== "--yes");
  const unsupported = argumentsList.filter((argument) => argument.startsWith("--") && argument !== "--yes");
  if (positional.length !== 1 || unsupported.length > 0 || argumentsList.length !== positional.length + Number(assumeYes)) {
    throw new Error("Uso: pnpm release:publish <nova-versão> [--yes]. Exemplo: pnpm release:publish 0.1.1");
  }
  return { version: positional[0], assumeYes };
}

export function assertSynchronizedBranch({ branch, head, originHead }) {
  if (branch !== "main") throw new Error(`A release só pode ser publicada a partir de main (branch atual: ${branch || "detached"}).`);
  if (head !== originHead) throw new Error("A branch main local não corresponde a origin/main. Faz pull/push antes de publicar.");
}

function statusPath(line) {
  const path = line.slice(3);
  return path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
}

export function assertOnlyReleaseVersionChanges(statusOutput) {
  const actual = statusOutput
    .split("\n")
    .filter(Boolean)
    .map(statusPath)
    .sort();
  const expected = [...releaseVersionFiles].sort();
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error(`A preparação da release alterou ficheiros inesperados: ${actual.join(", ") || "nenhum"}.`);
  }
}

async function run(command, argumentsList, rootDirectory, options = {}) {
  if (options.stdio === "inherit") {
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, argumentsList, { cwd: rootDirectory, stdio: "inherit" });
      child.once("error", rejectPromise);
      child.once("close", (code, signal) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`${command} terminou com código ${code ?? "desconhecido"}${signal ? ` (${signal})` : ""}.`));
      });
    });
    return { stdout: "", stderr: "" };
  }
  return execFileAsync(command, argumentsList, {
    cwd: rootDirectory,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function gitOutput(rootDirectory, ...argumentsList) {
  const { stdout } = await run("git", argumentsList, rootDirectory);
  return stdout.trimEnd();
}

async function assertClean(rootDirectory) {
  const status = await gitOutput(rootDirectory, "status", "--porcelain=v1", "--untracked-files=all");
  if (status) throw new Error("O repositório tem alterações. Faz commit ou guarda-as antes de publicar uma release.");
}

async function assertReleaseTagAbsent(rootDirectory, tag) {
  try {
    await run("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], rootDirectory);
  } catch (error) {
    if (error?.code === 1) return;
    throw error;
  }
  throw new Error(`A tag ${tag} já existe. Nunca reutilizes uma tag de release.`);
}

async function confirmRelease(tag) {
  const reader = createInterface({ input, output });
  try {
    const answer = await reader.question(`Escreve ${tag} para validar e publicar esta atualização: `);
    if (answer.trim() !== tag) throw new Error("Publicação cancelada: a confirmação não corresponde à tag.");
  } finally {
    reader.close();
  }
}

export async function publishRelease(rootDirectory, version, { assumeYes = false } = {}) {
  const currentVersion = assertSynchronizedVersions(await readProjectVersions(rootDirectory));
  const releaseKind = classifyReleaseVersion(currentVersion, version);
  const tag = `v${version}`;
  await run("git", ["fetch", "--prune", "origin", "main", "--tags"], rootDirectory);
  await assertClean(rootDirectory);
  assertSynchronizedBranch({
    branch: await gitOutput(rootDirectory, "branch", "--show-current"),
    head: await gitOutput(rootDirectory, "rev-parse", "HEAD"),
    originHead: await gitOutput(rootDirectory, "rev-parse", "origin/main"),
  });
  await assertReleaseTagAbsent(rootDirectory, tag);
  if (!assumeYes) await confirmRelease(tag);

  console.log("A validar código, dependências e aplicação nativa antes de alterar a versão...");
  await run("pnpm", ["release:verify"], rootDirectory, { stdio: "inherit" });
  await assertClean(rootDirectory);

  let result = { previousVersion: currentVersion, version };
  if (releaseKind === "upgrade") {
    result = await setProjectVersion(rootDirectory, version);
    const status = await gitOutput(rootDirectory, "status", "--porcelain=v1", "--untracked-files=all");
    assertOnlyReleaseVersionChanges(status);
    await run("git", ["diff", "--check"], rootDirectory);
    await run("git", ["add", "--", ...releaseVersionFiles], rootDirectory);
    const stagedFiles = await gitOutput(rootDirectory, "diff", "--cached", "--name-only");
    assertOnlyReleaseVersionChanges(stagedFiles.split("\n").filter(Boolean).map((path) => `M  ${path}`).join("\n"));
    await run("git", ["commit", "-m", `release: ${tag}`], rootDirectory, { stdio: "inherit" });
  }
  await run("git", ["tag", "-a", tag, "-m", `Nikufra CRM ${tag}`], rootDirectory);
  try {
    await run("git", ["push", "--atomic", "origin", "main", tag], rootDirectory, { stdio: "inherit" });
  } catch (error) {
    throw new Error(`A validação terminou e ${tag} ficou criada localmente, mas o push atómico falhou. Corrige a ligação e executa: git push --atomic origin main ${tag}`, { cause: error });
  }

  console.log(`${releaseKind === "current" ? "Primeira publicação" : `Atualização ${result.previousVersion} -> ${result.version}`} enviada. O GitHub está agora a assinar e publicar os instaladores.`);
  return { ...result, tag };
}

async function main() {
  const { version, assumeYes } = parsePublishArguments(process.argv.slice(2));
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await publishRelease(rootDirectory, version, { assumeYes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
