# LumaVault

LumaVault is a self-hosted, multi-tenant storage platform and app suite built with a Go storage core, a Node.js + Hono + PostgreSQL API, and Vite React web apps alongside Swift clients. See `docs/BLUEPRINT.md` for the full architecture and `AGENTS.md` for repo conventions and branch rules.

## Prerequisites

- Docker with Docker Compose (for PostgreSQL 16 and Mailpit)
- Go 1.26 or newer
- Node.js 26 or newer
- pnpm 12.21 (`corepack enable` or `pnpm` matching `packageManager` in `package.json`)
- Buf CLI (`buf`) for Protobuf linting and code generation
- macOS with Swift 6 / Xcode (only needed for the Swift SDK)

Optional first-time repo setup:

```bash
git config core.hooksPath .githooks
```

This enables the local branch-name and main-branch protection hooks in `.githooks/`.

## Run locally

You do not need a `.env` file to get started. `scripts/dev.sh` supplies local development defaults that match `docker-compose.yml`.

1. Start PostgreSQL and Mailpit in the background:

   ```bash
   docker compose up -d
   ```

2. Push the database tables into PostgreSQL:

   ```bash
   DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault pnpm --filter @lumavault/api run db:push
   ```

   `make dev` does not push tables for you, and `db:push` reads `DATABASE_URL` from the environment rather than `.env`.

3. Start the Storage Gateway, API, and Portal:

   ```bash
   make dev
   ```

   `make dev` runs `scripts/dev.sh`, which regenerates Protobuf stubs, installs JS dependencies, and builds `@lumavault/sdk` whenever they are out of date, then starts all three services with prefixed logs. If any one service exits, the script stops the rest so crashes are not hidden.

### Local services

| Service | Address | Notes |
| :-- | :-- | :-- |
| Portal | http://localhost:3000 | Redirects to `/setup` on an empty database to create the initial Super-Admin and household |
| API | http://localhost:4000 | Connect-RPC at `/api/rpc`, Better Auth at `/api/auth`, health check at `/healthz` |
| Storage Gateway | http://localhost:8080 | Stores chunks and object metadata locally under `.lumavault/` |
| Mailpit inbox | http://localhost:8025 | Catches all local emails (magic links, invites) via SMTP on port 1025 |
| PostgreSQL | `localhost:5432` | Default user, password, and database are all `lumavault` |

### Overriding settings with `.env`

Create a gitignored `.env` file at the repo root if you want to override ports, secrets, database credentials, or optional settings such as `LUMAVAULT_ADMIN_EMAIL`. `scripts/dev.sh` loads `.env` automatically. See `scripts/dev.sh`, `apps/api/src/config.ts`, `core/cmd/lumavault/config.go`, and `apps/portal/src/config.ts` for all supported variables.

## Pause, resume, and reset

- Stop the app processes (`make dev`): press `Ctrl-C`. The script tears down the Gateway, API, and Portal process groups cleanly. PostgreSQL and Mailpit keep running in Docker.
- Pause Docker services without losing data:

  ```bash
  docker compose stop
  ```

  Resume them later with `docker compose start` (or `docker compose up -d`), then run `make dev` again.

- Stop and remove containers while keeping the PostgreSQL volume:

  ```bash
  docker compose down
  ```

- Reset PostgreSQL for a fresh first-run `/setup`:

  ```bash
  docker compose down -v
  docker compose up -d
  DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault pnpm --filter @lumavault/api run db:push
  ```

- Clear Storage Gateway chunks and object metadata (stop `make dev` first):

  ```bash
  rm -rf .lumavault
  ```

- Remove generated Protobuf stubs and build artifacts:

  ```bash
  make clean
  ```

## Making changes

### Reload behavior under `make dev`

- API (`apps/api`): restarts automatically on file edits via `tsx watch`.
- Portal (`apps/portal`) and shared UI (`packages/ui`): hot-reloads via Vite. Adding or renaming route files under `apps/portal/src/routes/` updates `apps/portal/src/routeTree.gen.ts` automatically while Vite is running (or run `pnpm --filter @lumavault/portal run routes:generate` manually).
- Storage Gateway (`core/`): runs under `go run` and does not hot-reload. Press `Ctrl-C` and run `make dev` again after Go edits, or run the Gateway on its own with `make run`.
- Web SDK (`sdk/web`): workspace packages import from `sdk/web/dist/`. After editing `sdk/web/src/`, rebuild it:

  ```bash
  pnpm --filter @lumavault/sdk run build
  ```

### Protobuf contracts (`proto/`)

Generated stubs (`core/gen/go/`, `sdk/web/src/gen/`, `sdk/swift/Sources/LumaVaultSDK/Gen/`) are gitignored. After editing any `.proto` file, regenerate them and rebuild the web SDK:

```bash
make proto
pnpm --filter @lumavault/sdk run build
```

### Email templates

Preview React Email templates locally at http://localhost:3030:

```bash
pnpm --filter @lumavault/api run email:preview
```

### Formatting

Prettier is configured at `.prettierrc`. Format modified files with:

```bash
pnpm exec prettier --write <path>
```

## Database schema and migrations

LumaVault currently uses Drizzle schema push (`drizzle-kit push`) instead of versioned SQL migration files. Table definitions live under `apps/api/src/db/schemas/`, separated into one PostgreSQL schema per domain: `auth`, `iam`, `photos`, `cinema`, and `arcade`.

- Push all schemas after editing table definitions:

  ```bash
  DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault pnpm --filter @lumavault/api run db:push
  ```

- Push only one schema without touching the others (useful when switching between feature branches):

  ```bash
  DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault DB_SCHEMA=iam pnpm --filter @lumavault/api run db:push
  ```

  `DB_SCHEMA` accepts a comma-separated list of schema names.

- Better Auth tables (`apps/api/src/db/schemas/auth.ts`): generated, do not edit by hand. After changing Better Auth plugins in `apps/api/src/auth/auth.ts`, regenerate the schema file, verify it, and push:

  ```bash
  pnpm --filter @lumavault/api run auth:generate
  pnpm --filter @lumavault/api run auth:check
  DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault DB_SCHEMA=auth pnpm --filter @lumavault/api run db:push
  ```

- Browse tables visually with Drizzle Studio:

  ```bash
  DATABASE_URL=postgres://lumavault:lumavault@localhost:5432/lumavault pnpm --filter @lumavault/api run drizzle:studio
  ```

## Tests, linting, and builds

PostgreSQL must be running (`docker compose up -d`) for API tests. Each API test file creates and drops its own throwaway database (`lv_test_*`) on `TEST_DATABASE_URL` (default `postgres://lumavault:lumavault@localhost:5432/lumavault`), so tests never touch your local dev data and can run concurrently across worktrees.

### Full workspace checks

```bash
make lint    # buf lint, go vet, TypeScript typecheck across JS packages, swift build
make test    # Go (-race), JS workspace (sdk, ui, api, portal unit tests), and Swift tests
make build   # bin/lumavault, all JS packages, and Swift SDK
```

Run a single language slice with `make lint-go`, `make lint-js`, `make lint-swift`, `make test-go`, `make test-js`, or `make test-swift`.

### Targeted test runs

```bash
# Go Storage Core (one package or test)
go test -race ./core/internal/gateway -run TestName

# Web SDK
pnpm --filter @lumavault/sdk run test

# Shared UI hooks and components
pnpm --filter @lumavault/ui run test

# API (all tests or one file)
pnpm --filter @lumavault/api run test
pnpm --filter @lumavault/api exec vitest run test/guards.test.ts

# Portal unit and component tests (excludes Playwright e2e/)
pnpm --filter @lumavault/portal run test
```

`make test-swift` runs Swift SDK unit and integration tests and automatically starts a local Storage Gateway binary during the run.

### Portal end-to-end tests (Playwright)

The Playwright suite in `apps/portal/e2e/portal.spec.ts` exercises first-run setup, password/passkey/magic-link sign-in (reading emails from Mailpit), invites, household management, allowances, and Apple TV pairing against the real API and Portal.

Each run automatically drops, recreates, and pushes schemas into a dedicated `lumavault_e2e` database on your running PostgreSQL container and serves the API and Portal on ports 4001 and 3004, so it never wipes your local dev database and can run while `make dev` is up. (It still shares local Mailpit on port 8025 and clears Mailpit messages between runs.)

1. Make sure PostgreSQL and Mailpit are running:

   ```bash
   docker compose up -d
   ```

2. Install Playwright Chromium (first time only):

   ```bash
   pnpm --filter @lumavault/portal exec playwright install chromium
   ```

3. Build the Web SDK if you have not already (`make dev` also does this):

   ```bash
   pnpm --filter @lumavault/sdk run build
   ```

4. Run the E2E suite:

   ```bash
   pnpm --filter @lumavault/portal run test:e2e
   ```

To override defaults, set `E2E_DATABASE_URL` (database name must end with `_e2e`), `E2E_API_PORT`, `E2E_PORTAL_PORT`, `E2E_API_URL`, `E2E_PORTAL_URL`, or `MAILPIT_URL` (see `apps/portal/playwright.config.ts`).
