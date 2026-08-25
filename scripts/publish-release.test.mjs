import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOnlyReleaseVersionChanges,
  assertSynchronizedBranch,
  parsePublishArguments,
  publishRelease,
  releaseVersionFiles,
} from "./publish-release.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const originalPath = process.env.PATH;

async function git(root, ...argumentsList) {
  const { stdout } = await execFileAsync("git", argumentsList, { cwd: root });
  return stdout.trim();
}

async function releaseRepository() {
  const container = await mkdtemp(join(tmpdir(), "nikufra-publish-"));
  temporaryDirectories.push(container);
  const root = join(container, "work");
  const remote = join(container, "remote.git");
  const bin = join(container, "bin");
  await Promise.all([mkdir(root), mkdir(bin)]);
  await mkdir(join(root, "src-tauri"));
  await Promise.all([
    writeFile(join(root, "package.json"), `${JSON.stringify({ name: "nikufra-crm", version: "0.1.0" }, null, 2)}\n`),
    writeFile(join(root, "src-tauri", "tauri.conf.json"), `${JSON.stringify({ productName: "Nikufra CRM", version: "0.1.0" }, null, 2)}\n`),
    writeFile(join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "nikufra-crm"\nversion = "0.1.0"\nedition = "2021"\n'),
    writeFile(join(root, "src-tauri", "Cargo.lock"), 'version = 4\n\n[[package]]\nname = "nikufra-crm"\nversion = "0.1.0"\ndependencies = []\n'),
  ]);
  const fakePnpm = join(bin, "pnpm");
  await writeFile(fakePnpm, "#!/bin/sh\nexit 0\n");
  await chmod(fakePnpm, 0o755);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Nikufra Test");
  await git(root, "config", "user.email", "test@nikufra.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  await execFileAsync("git", ["init", "--bare", remote]);
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-u", "origin", "main");
  process.env.PATH = `${bin}:${originalPath}`;
  return { root, remote };
}

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("publicação de releases", () => {
  it("aceita uma versão e confirmação opcional explícita", () => {
    expect(parsePublishArguments(["0.1.1"])).toEqual({ version: "0.1.1", assumeYes: false });
    expect(parsePublishArguments(["0.1.1", "--yes"])).toEqual({ version: "0.1.1", assumeYes: true });
    expect(() => parsePublishArguments([])).toThrow("Uso:");
    expect(() => parsePublishArguments(["0.1.1", "--force"])).toThrow("Uso:");
    expect(() => parsePublishArguments(["0.1.1", "0.1.2"])).toThrow("Uso:");
  });

  it("exige main exatamente sincronizada com origin", () => {
    expect(() => assertSynchronizedBranch({ branch: "main", head: "abc", originHead: "abc" })).not.toThrow();
    expect(() => assertSynchronizedBranch({ branch: "feature", head: "abc", originHead: "abc" })).toThrow("main");
    expect(() => assertSynchronizedBranch({ branch: "main", head: "abc", originHead: "def" })).toThrow("origin/main");
  });

  it("aceita exclusivamente os quatro ficheiros de versão", () => {
    const status = releaseVersionFiles.map((path) => ` M ${path}`).join("\n");
    expect(() => assertOnlyReleaseVersionChanges(status)).not.toThrow();
    expect(() => assertOnlyReleaseVersionChanges(`${status}\n M src/App.tsx`)).toThrow("inesperados");
    expect(() => assertOnlyReleaseVersionChanges(status.replace(" M package.json\n", ""))).toThrow("inesperados");
  });

  it("publica atomicamente a primeira tag sem criar um commit artificial", async () => {
    const { root, remote } = await releaseRepository();
    const headBefore = await git(root, "rev-parse", "HEAD");
    await expect(publishRelease(root, "0.1.0", { assumeYes: true })).resolves.toEqual({
      previousVersion: "0.1.0",
      version: "0.1.0",
      tag: "v0.1.0",
    });
    expect(await git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await git(remote, "rev-list", "-n", "1", "refs/tags/v0.1.0")).toBe(headBefore);
  });

  it("valida, versiona, cria commit e envia uma atualização", async () => {
    const { root, remote } = await releaseRepository();
    await expect(publishRelease(root, "0.1.1", { assumeYes: true })).resolves.toEqual({
      previousVersion: "0.1.0",
      version: "0.1.1",
      tag: "v0.1.1",
    });
    const packageSource = await git(remote, "show", "main:package.json");
    expect(JSON.parse(packageSource).version).toBe("0.1.1");
    expect(await readFile(join(root, "src-tauri", "Cargo.toml"), "utf8")).toContain('version = "0.1.1"');
    expect(await git(remote, "rev-list", "-n", "1", "refs/tags/v0.1.1")).toBe(await git(root, "rev-parse", "HEAD"));
  });
});
