import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertIncreasingStableVersion,
  assertSynchronizedVersions,
  classifyReleaseVersion,
  readProjectVersions,
  setProjectVersion,
} from "./set-version.mjs";

const temporaryDirectories = [];

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "nikufra-version-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "src-tauri"));
  const versions = { packageJson: "0.1.0", tauriConfig: "0.1.0", cargoManifest: "0.1.0", cargoLock: "0.1.0", ...overrides };
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "nikufra-crm", version: versions.packageJson }, null, 2)),
    writeFile(join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ productName: "Nikufra CRM", version: versions.tauriConfig }, null, 2)),
    writeFile(join(root, "src-tauri", "Cargo.toml"), `[package]\nname = "nikufra-crm"\nversion = "${versions.cargoManifest}"\nedition = "2021"\n`),
    writeFile(join(root, "src-tauri", "Cargo.lock"), `version = 4\n\n[[package]]\nname = "nikufra-crm"\nversion = "${versions.cargoLock}"\ndependencies = []\n`),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("versionamento de releases", () => {
  it("atualiza e confirma os quatro ficheiros de versão", async () => {
    const root = await fixture();
    await expect(setProjectVersion(root, "0.1.1")).resolves.toEqual({ previousVersion: "0.1.0", version: "0.1.1" });
    expect(await readProjectVersions(root)).toEqual({
      packageJson: "0.1.1",
      tauriConfig: "0.1.1",
      cargoManifest: "0.1.1",
      cargoLock: "0.1.1",
    });
    await expect(readFile(join(root, "src-tauri", "Cargo.toml"), "utf8")).resolves.toContain('version = "0.1.1"');
  });

  it("recusa uma base desalinhada", async () => {
    const root = await fixture({ cargoLock: "0.0.9" });
    await expect(setProjectVersion(root, "0.1.1")).rejects.toThrow("Versões desalinhadas");
  });

  it("recusa versões inválidas, iguais ou inferiores", async () => {
    const root = await fixture();
    await expect(setProjectVersion(root, "v0.1.1")).rejects.toThrow("Versão inválida");
    await expect(setProjectVersion(root, "0.1.0")).rejects.toThrow("tem de ser superior");
    await expect(setProjectVersion(root, "0.0.9")).rejects.toThrow("tem de ser superior");
  });

  it("expõe uma validação simples para os portões CI", () => {
    expect(assertSynchronizedVersions({ packageJson: "2.3.4", tauriConfig: "2.3.4" })).toBe("2.3.4");
    expect(assertIncreasingStableVersion("2.3.4", "2.3.5")).toBe("2.3.5");
    expect(() => assertIncreasingStableVersion("2.3.4", "v2.3.5")).toThrow("Versão inválida");
    expect(classifyReleaseVersion("2.3.4", "2.3.4")).toBe("current");
    expect(classifyReleaseVersion("2.3.4", "2.4.0")).toBe("upgrade");
    expect(() => classifyReleaseVersion("2.3.4", "2.3.3")).toThrow("inferior");
  });
});
