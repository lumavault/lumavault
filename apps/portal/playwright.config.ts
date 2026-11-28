import { defineConfig, devices } from '@playwright/test'

// The suite expects an empty database because it runs first-run setup. CI starts from a fresh
// one; locally, run it against a throwaway database with make dev style settings.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Both servers inherit process.env, so the API settings come from CI or the local shell.
  webServer: [
    {
      command: 'pnpm --dir ../api run dev',
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
