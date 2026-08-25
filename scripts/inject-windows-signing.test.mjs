import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { injectWindowsSigning, windowsSignCommand } from "./inject-windows-signing.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("assinatura Windows", () => {
  it("gera um comando Azure estritamente validado", () => {
    expect(windowsSignCommand({ endpoint: "https://wus2.codesigning.azure.net/", account: "nikufra-prod", profile: "crm" }))
      .toBe('artifact-signing-cli -e https://wus2.codesigning.azure.net -a nikufra-prod -c crm -d "Nikufra CRM" %1');
    expect(() => windowsSignCommand({ endpoint: "http://invalid.test", account: "x", profile: "y" })).toThrow("HTTPS");
    expect(() => windowsSignCommand({ endpoint: "https://valid.test", account: "x && bad", profile: "y" })).toThrow("caracteres");
  });

  it("injeta a configuração apenas no ficheiro indicado", async () => {
    const root = await mkdtemp(join(tmpdir(), "nikufra-windows-signing-"));
    temporaryDirectories.push(root);
    const path = join(root, "tauri.conf.json");
    await writeFile(path, JSON.stringify({ bundle: { active: true } }));
    await injectWindowsSigning(path, { endpoint: "https://neu.codesigning.azure.net", account: "nikufra", profile: "production" });
    const config = JSON.parse(await readFile(path, "utf8"));
    expect(config.bundle.active).toBe(true);
    expect(config.bundle.windows.signCommand).toContain("artifact-signing-cli");
  });
});
