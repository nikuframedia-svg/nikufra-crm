import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertReleaseEnvironment, requiredReleaseVariables, verifyReleaseState } from "./release-preflight.mjs";

const temporaryDirectories = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nikufra-preflight-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "src-tauri"));
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" })),
    writeFile(join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "1.2.3" })),
    writeFile(join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "nikufra-crm"\nversion = "1.2.3"\n'),
    writeFile(join(root, "src-tauri", "Cargo.lock"), 'version = 4\n\n[[package]]\nname = "nikufra-crm"\nversion = "1.2.3"\n'),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("portão de release", () => {
  it("aceita apenas a tag correspondente e todas as credenciais", async () => {
    const rootDirectory = await fixture();
    const environment = Object.fromEntries(requiredReleaseVariables.map((name) => [name, "configurado"]));
    await expect(verifyReleaseState({ rootDirectory, refType: "tag", refName: "v1.2.3", environment })).resolves.toBe("1.2.3");
  });

  it("bloqueia uma tag diferente da versão", async () => {
    const rootDirectory = await fixture();
    await expect(verifyReleaseState({
      rootDirectory,
      refType: "tag",
      refName: "v1.2.2",
      environment: {},
      requireExternalCredentials: false,
    })).rejects.toThrow("tem de ser v1.2.3");
  });

  it("enumera configurações de assinatura em falta sem revelar valores", () => {
    expect(() => assertReleaseEnvironment({ TAURI_UPDATER_PUBKEY: "presente" })).toThrow("APPLE_CERTIFICATE");
  });
});
