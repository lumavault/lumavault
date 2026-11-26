import { defineConfig, devices } from '@playwright/test'

const apiPort = process.env.E2E_API_PORT ?? '4000'
const portalPort = process.env.E2E_PORTAL_PORT ?? '3000'
const apiUrl = process.env.E2E_API_URL ?? `http://localhost:${apiPort}`
const portalUrl = process.env.E2E_PORTAL_URL ?? `http://localhost:${portalPort}`

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
      command: 'pnpm --dir ../api run start',
      url: `${apiUrl}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PORT: apiPort,
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgres://lumavault:lumavault@localhost:5432/lumavault',
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
        LUMAVAULT_WEB_ORIGINS: `${portalUrl},http://localhost:3001,http://localhost:3002,http://localhost:3003`,
        SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
      },
    },
    {
      command: `pnpm exec vite --port ${portalPort} --strictPort`,
      url: portalUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_API_URL: apiUrl,
        VITE_PORTAL_URL: portalUrl,
      },
    },
  ],
})
