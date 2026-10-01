import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("shared Gmail/Outreach message ownership", () => {
  it("always projects the provider message into each CRM contact timeline", async () => {
    const source = await readFile(
      new URL("../../../infra/volumes/functions/gmail-sync/index.ts", import.meta.url),
      "utf8",
    );
    const claim = source.indexOf('admin.rpc("claim_google_provider_message"');
    const contactProjection = source.indexOf("for (const externalEmail of externalEmails)", claim);
    const activityProjection = source.indexOf('admin.from("atividades").upsert', contactProjection);
    const guardedRegion = source.slice(claim, contactProjection);

    expect(claim).toBeGreaterThan(-1);
    expect(contactProjection).toBeGreaterThan(claim);
    expect(activityProjection).toBeGreaterThan(contactProjection);
    expect(guardedRegion).not.toMatch(/if\s*\([^)]*(?:claim|ownsSharedEffects)[^)]*\)\s*continue/);
    expect(source.slice(activityProjection, activityProjection + 1_200)).toContain(
      'onConflict: "source_mailbox_email,message_id,contacto_id"',
    );
  });

  it("repairs legacy activity mailbox identities before rebuilding uniqueness", async () => {
    const migration = await readFile(
      new URL("../../../supabase/migrations/202610010002_gmail_activity_mailbox_backfill.sql", import.meta.url),
      "utf8",
    );
    const dropIndex = migration.indexOf("drop index if exists public.atividades_mailbox_provider_message_unique");
    const conflictResolution = migration.indexOf("row_number() over");
    const backfill = migration.indexOf("update public.atividades activity");
    const rebuiltIndex = migration.indexOf("create unique index atividades_mailbox_provider_message_unique");

    expect(dropIndex).toBeGreaterThan(-1);
    expect(conflictResolution).toBeGreaterThan(dropIndex);
    expect(backfill).toBeGreaterThan(conflictResolution);
    expect(rebuiltIndex).toBeGreaterThan(backfill);
    expect(migration).toContain("left join public.profiles profile on profile.id=activity.user_id");
    expect(migration).toContain("set_atividade_source_mailbox_email");
  });
});
