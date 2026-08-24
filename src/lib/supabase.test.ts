import { describe, expect, it } from "vitest";
import { consumeAppDeepLink } from "./supabase";

describe("desktop deep links", () => {
  it("recognizes a successful Gmail OAuth callback", async () => {
    await expect(consumeAppDeepLink("nikufra-crm://oauth/google?status=connected")).resolves.toBe("gmail");
  });

  it("rejects an OAuth callback with an error", async () => {
    await expect(consumeAppDeepLink("nikufra-crm://oauth/google?error=access_denied")).rejects.toThrow("access_denied");
  });

  it("ignores schemes outside the registered application protocol", async () => {
    await expect(consumeAppDeepLink("https://crm.nikufra.ai/auth")).resolves.toBeNull();
  });
});
