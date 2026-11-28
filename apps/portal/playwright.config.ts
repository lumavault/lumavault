import { defineConfig, devices } from '@playwright/test'

const apiPort = process.env.E2E_API_PORT ?? '4001'
const portalPort = process.env.E2E_PORTAL_PORT ?? '3004'
const apiUrl = process.env.E2E_API_URL ?? `http://localhost:${apiPort}`
const portalUrl = process.env.E2E_PORTAL_URL ?? `http://localhost:${portalPort}`
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgres://lumavault:lumavault@localhost:5432/lumavault_e2e'

// Runs against the dedicated lumavault_e2e database (reset by test:e2e) on non-dev ports
// so local dev data and a running make dev stack are never touched.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: portalUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --dir ../api run dev',
      url: `${apiUrl}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: apiPort,
        DATABASE_URL: databaseUrl,
        LUMAVAULT_GATEWAY_URL:
          process.env.LUMAVAULT_GATEWAY_URL ?? 'http://localhost:8080',
        LUMAVAULT_TICKET_SECRET:
          process.env.LUMAVAULT_TICKET_SECRET ??
          'e2e-only-ticket-secret-0123456789abcdef',
        LUMAVAULT_SERVICE_KEY:
          process.env.LUMAVAULT_SERVICE_KEY ??
          'e2e-only-service-key-0123456789abcdef',
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ??
          'e2e-only-better-auth-secret-0123456789abcdef',
        LUMAVAULT_PORTAL_URL: portalUrl,
        LUMAVAULT_WEB_ORIGINS: portalUrl,
        SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
      },
    },
    {
      command: `pnpm exec vite --port ${portalPort} --strictPort`,
      url: portalUrl,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_API_URL: apiUrl,
        VITE_PORTAL_URL: portalUrl,
      },
    },
  ],
})
