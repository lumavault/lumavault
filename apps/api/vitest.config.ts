import { defineConfig } from "vitest/config";

// Each run migrates one template database, and every test file copies it. Copies queue up
// briefly when every workspace package's tests run at once, as in make test and CI.
export default defineConfig({
  test: { globalSetup: ["src/db/test-template.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
