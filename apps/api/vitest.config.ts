import { defineConfig } from "vitest/config";

// Each test file creates and fills its own Postgres database, which can take several
// seconds when every workspace package's tests run at once, as in make test and CI.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
