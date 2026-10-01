import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLegacySnapshot, sanitizeLegacySnapshot, stableSnapshotHash } from "../src/migration.js";
import { parseMigrationArguments } from "../src/migration-cli.js";

describe("legacy migration input", () => {
  it("removes every credential/token field before database import", () => {
    const clean = sanitizeLegacySnapshot({
      version: 1,
      credentials: { password: "bad" },
      mailboxes: [{
        id: "m",
        email: "m@nikufra.ai",
        provider: "google",
        refreshToken: "secret-a",
        access_token: "secret-b",
        SMTP_PASSWORD: "secret-c",
        settings: { client_secret: "secret-d", oauth_state: "secret-e", webhookSigningKey: "secret-f", dailyLimit: 10 },
      }],
      unsubscribe_tokens: ["secret-g"],
    });
    expect(JSON.stringify(clean)).not.toMatch(/secret-[a-g]|password|refresh.?token|access.?token|oauth.?state|webhook|unsubscribe.?token/i);
    expect(clean).toMatchObject({ version: 1, mailboxes: [{ id: "m", email: "m@nikufra.ai", provider: "google", settings: { dailyLimit: 10 } }] });
  });

  it("produces a deterministic checksum for idempotent reruns", () => {
    const snapshot = { version: 1, campaigns: [{ id: "c1" }] };
    expect(stableSnapshotHash(snapshot)).toBe(stableSnapshotHash(snapshot));
    expect(stableSnapshotHash(snapshot)).not.toBe(stableSnapshotHash({ version: 1, campaigns: [] }));
  });

  it("defaults to dry-run and requires an explicit, non-conflicting apply flag", () => {
    expect(parseMigrationArguments(["--input", "/imports/snapshot.json", "--dry-run"])).toEqual({ input: "/imports/snapshot.json", apply: false });
    expect(parseMigrationArguments(["--input=/imports/snapshot.json", "--apply"])).toEqual({ input: "/imports/snapshot.json", apply: true });
    expect(() => parseMigrationArguments(["--input", "/imports/snapshot.json", "--dry-run", "--apply"])).toThrow(/apenas/);
    expect(() => parseMigrationArguments(["--import-key=secret-value", "--input", "/imports/snapshot.json"])).toThrow(/--import-key/);
  });

  it("accepts a valid snapshot larger than 8 MB without lowering the 64 MB safety bound", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outreach-migration-"));
    const path = join(directory, "snapshot.json");
    try {
      await writeFile(path, JSON.stringify({ version: 1, harmlessMetadata: "x".repeat(8 * 1024 * 1024 + 1) }), "utf8");
      const snapshot = await readLegacySnapshot(path) as { harmlessMetadata: string };
      expect(snapshot.harmlessMetadata.length).toBeGreaterThan(8 * 1024 * 1024);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
