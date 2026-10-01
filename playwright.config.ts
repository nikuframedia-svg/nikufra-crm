import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:1420";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "/tmp/nikufra-playwright-results",
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet-1024", use: { viewport: { width: 1024, height: 768 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_OUTREACH_ADMIN_ONLY=false pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
