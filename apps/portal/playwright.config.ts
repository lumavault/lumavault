import { defineConfig, devices } from "@playwright/test";
import { API_PORT, API_URL, e2eDatabaseUrl, MAILBOX_URL, PORTAL_PORT, PORTAL_URL, SMTP_PORT } from "./e2e/env";

const secret = "e2e-secret-that-is-at-least-thirty-two-bytes";

// Runs the real API on a fresh Postgres database, the Portal dev server, and a fake mail
// server, then drives the Portal in Chromium. The flows build on each other, so they run in order.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: PORTAL_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx e2e/mail-server.ts",
      url: MAILBOX_URL,
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx src/tools/e2e-database.ts && pnpm exec tsx src/index.ts",
      cwd: "../api",
      url: `${API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: e2eDatabaseUrl(),
        LUMAVAULT_GATEWAY_URL: "http://localhost:8080",
        LUMAVAULT_TICKET_SECRET: secret,
        LUMAVAULT_SERVICE_KEY: secret,
        BETTER_AUTH_SECRET: secret,
        LUMAVAULT_API_URL: API_URL,
        LUMAVAULT_WEB_ORIGINS: PORTAL_URL,
        LUMAVAULT_PORTAL_URL: PORTAL_URL,
        SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`,
      },
    },
    {
      command: `pnpm exec vite --port ${PORTAL_PORT} --strictPort`,
      url: PORTAL_URL,
      reuseExistingServer: false,
      env: { VITE_API_URL: API_URL, VITE_PORTAL_URL: PORTAL_URL },
    },
  ],
});
