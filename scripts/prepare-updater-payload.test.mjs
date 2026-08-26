import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareUpdaterPayload } from "./prepare-updater-payload.mjs";

const temporaryDirectories = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nikufra-release-"));
  temporaryDirectories.push(root);
  const releaseDir = join(root, "release");
  const payloadDir = join(root, "payload");
  await mkdir(releaseDir);
  const files = ["Nikufra.app.tar.gz", "Nikufra.exe.zip", "Nikufra_0.1.0_universal.dmg", "Nikufra_0.1.0_x64-setup.exe"];
  await Promise.all(files.map((name) => writeFile(join(releaseDir, name), `conteúdo:${name}`)));
  await writeFile(join(releaseDir, "latest.json"), JSON.stringify({
    version: "0.1.0",
    notes: "Primeira versão",
    pub_date: "2026-08-25T18:00:00Z",
    platforms: {
      "darwin-aarch64": { signature: "mac-signature", url: "https://github.test/Nikufra.app.tar.gz" },
      "darwin-x86_64": { signature: "mac-signature", url: "https://github.test/Nikufra.app.tar.gz" },
      "windows-x86_64": { signature: "win-signature", url: "https://github.test/Nikufra.exe.zip" },
    },
  }));
  return { releaseDir, payloadDir };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prepareUpdaterPayload", () => {
  it("validates signed platforms and creates stable public installer links", async () => {
    const { releaseDir, payloadDir } = await fixture();
    const result = await prepareUpdaterPayload({
      releaseDir,
      payloadDir,
      baseUrl: "https://crm.nikufra.ai/updates/assets/",
      expectedVersion: "0.1.0",
    });

    expect(result.manifest.platforms["darwin-aarch64"].url).toBe("https://crm.nikufra.ai/updates/assets/Nikufra.app.tar.gz");
    expect(result.manifest.platforms["windows-x86_64"].signature).toBe("win-signature");
    expect(result.downloads.macos.url).toBe("https://crm.nikufra.ai/updates/assets/Nikufra-CRM-macOS.dmg");
    expect(result.downloads.windows.url).toBe("https://crm.nikufra.ai/updates/assets/Nikufra-CRM-Windows.exe");
    expect(result.downloads.trust).toEqual({ updaterSigned: true, macosNotarized: true, windowsAuthenticode: true });
    await expect(readFile(join(payloadDir, "assets", "Nikufra-CRM-macOS.dmg"), "utf8")).resolves.toContain("universal.dmg");
    await expect(readFile(join(payloadDir, "downloads.json"), "utf8")).resolves.toContain('"version": "0.1.0"');
  });

  it("marks internal installers without claiming operating-system trust", async () => {
    const { releaseDir, payloadDir } = await fixture();
    const result = await prepareUpdaterPayload({
      releaseDir,
      payloadDir,
      baseUrl: "https://crm.nikufra.ai/updates/assets/",
      expectedVersion: "0.1.0",
      releaseTrust: "internal",
    });

    expect(result.downloads.trust).toEqual({ updaterSigned: true, macosNotarized: false, windowsAuthenticode: false });
  });

  it("resolves GitHub API asset URLs to the downloaded release filenames", async () => {
    const { releaseDir, payloadDir } = await fixture();
    const manifestPath = join(releaseDir, "latest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.platforms["darwin-aarch64"].url = "https://api.github.com/repos/nikufra/crm/releases/assets/101";
    manifest.platforms["darwin-x86_64"].url = "https://api.github.com/repos/nikufra/crm/releases/assets/101";
    manifest.platforms["windows-x86_64"].url = "https://api.github.com/repos/nikufra/crm/releases/assets/202";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(releaseDir, "release-assets.json"), JSON.stringify([
      { apiUrl: "https://api.github.com/repos/nikufra/crm/releases/assets/101", name: "Nikufra.app.tar.gz" },
      { apiUrl: "https://api.github.com/repos/nikufra/crm/releases/assets/202", name: "Nikufra.exe.zip" },
    ]));

    const result = await prepareUpdaterPayload({
      releaseDir,
      payloadDir,
      baseUrl: "https://crm.nikufra.ai/updates/assets/",
      expectedVersion: "0.1.0",
      releaseTrust: "internal",
    });

    expect(result.manifest.platforms["darwin-aarch64"].url).toBe("https://crm.nikufra.ai/updates/assets/Nikufra.app.tar.gz");
    expect(result.manifest.platforms["windows-x86_64"].url).toBe("https://crm.nikufra.ai/updates/assets/Nikufra.exe.zip");
  });

  it("refuses an incomplete or mismatched update manifest", async () => {
    const { releaseDir, payloadDir } = await fixture();
    await expect(prepareUpdaterPayload({
      releaseDir,
      payloadDir,
      baseUrl: "https://crm.nikufra.ai/updates/assets/",
      expectedVersion: "0.2.0",
    })).rejects.toThrow("não corresponde");
  });
});
