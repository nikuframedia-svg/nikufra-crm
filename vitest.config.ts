import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["services/outreach/**", "tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
