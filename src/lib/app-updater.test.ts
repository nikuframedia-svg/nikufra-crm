import { describe, expect, it } from "vitest";
import { checkForAppUpdate, isDesktopApp } from "./app-updater";

describe("desktop updater boundary", () => {
  it("does not contact the updater from tests or the web fallback", async () => {
    expect(isDesktopApp()).toBe(false);
    await expect(checkForAppUpdate()).resolves.toBeNull();
  });
});
