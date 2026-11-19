# LumaVault Agent & Multi-Worktree Development Guide

Always read [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the full architecture and system design.

## 1. Worktrees, Ownership & Linear Docs

Each agent conversation works in its own git worktree, mapped to one Linear issue in the Lumavault (`LUM`) team.

**Linear is the single source of truth for scoping and design docs.** Draft and revise them directly in Linear (`save_document`) under the target project. Do not keep local copies. Only long-lived architecture that the user approves gets copied into `docs/` (for example `docs/BLUEPRINT.md`).

**Doc workflow** (scoping docs, design docs, CUJ specs):
1. Draft the doc in Linear. A scoping doc lists the proposed issues with title, goal, owned paths, dependencies, and acceptance criteria.
2. Run review subagents on it (for example `/ponytail-audit`). Post one `[AGENT]` comment per finding on the doc, quoting the line it refers to and the proposed change.
3. The user reviews the draft and the findings in one pass, leaving inline comments.
4. Address the comments: `list_comments`, reply in-thread to every thread whose latest comment does not start with `[AGENT]`, and update the doc. Repeat until the user approves.
5. For scoping docs, create the issues (`save_issue`) only after approval. Never create issues before that, except idea issues (below).

**Ideas and future features:** record any feature that is not ready for scoping as an idea issue, so it is not forgotten. Linear is the only place ideas live, not `docs/`, TODO comments, or chat.
- Create it in the matching project's Backlog with the `idea` label. Check `list_issues` first to avoid duplicates.
- A title and one or two sentences are enough. Skip the issue template.
- When a milestone finishes, review that project's idea issues with the user: promote, keep, or cancel each one.
- To promote an idea, write a scoping doc for it. After approval, turn the idea issue into the real issue (drop the label, fill in the template) or close it as a duplicate of the new issues.

**Comment prefix:** every comment or reply an agent posts in Linear starts with `[AGENT] `. User comments have no prefix.

**Stay inside your issue's owned paths** (table below) unless the issue explicitly covers cross-package work.

**Contracts are the boundary:** `proto/lumavault/v1/`, `pkg/metadata/store.go` (`MetadataStore`), and `pkg/chunkstore/store.go` (`ChunkStore`) are shared contracts. Do not break their signatures without updating all callers and running `make proto`. Generated stubs (`gen/go/`, `sdk/web/src/gen/`, `sdk/swift/Sources/LumaVaultSDK/Gen/`) are gitignored.

| Execution Order & Project | Linear ID | Owned Paths |
| :--- | :--- | :--- |
| **`1. Core Backend, Contracts & Basic Data Layer`** | `P-LUM-1` | `proto/lumavault/v1/storage.proto`, `buf.*`, `Makefile`, `docker-compose.yml`, `.gitignore`, `go.*`, `Package.swift`, `sdk/web/package.json`, `sdk/web/tsconfig.json`, `pkg/constants/`, `pkg/validate/`, `pkg/metadata/`, `pkg/chunkstore/`, `pkg/gateway/`, `cmd/lumavault/` |
| **`2. Client SDKs (Web/TypeScript & Swift)`** | `P-LUM-2` | `sdk/web/`, `sdk/swift/`, `sdk/testdata/`, `Package.swift`, `Makefile` (SDK test targets) |
| **`3. App Platform, Auth & Multi-Tenant RBAC`** | `P-LUM-7` | `pnpm-workspace.yaml`, `proto/lumavault/iam/v1/iam.proto`, `packages/ui/`, `apps/portal/`, `apps/api/` *(excluding per-app `schemas/{photos,cinema,arcade}.ts`, `migrations/{photos,cinema,arcade}/`, `routers/{photos,cinema,arcade}.ts`, and `workers/photos*.ts`)* |
| **`4. LumaVault Photos`** | `P-LUM-3` | `proto/lumavault/photos/v1/photos.proto`, `apps/api/src/db/schemas/photos.ts`, `apps/api/migrations/photos/`, `apps/api/src/routers/photos.ts`, `apps/api/src/workers/photos*.ts`, `apps/photos/` |
| **`5. LumaVault Cinema`** | `P-LUM-4` | `proto/lumavault/cinema/v1/cinema.proto`, `apps/api/src/db/schemas/cinema.ts`, `apps/api/migrations/cinema/`, `apps/api/src/routers/cinema.ts`, `apps/cinema/` |
| **`6. LumaVault Arcade`** | `P-LUM-5` | `proto/lumavault/arcade/v1/arcade.proto`, `apps/api/src/db/schemas/arcade.ts`, `apps/api/migrations/arcade/`, `apps/api/src/routers/arcade.ts`, `apps/arcade/` |
| **`7. Distributed Systems Upgrades (Paxos & Chunkservers)`** | `P-LUM-6` | `proto/lumavault/v1/paxos.proto`, `proto/lumavault/v1/chunk.proto`, `pkg/consensus/`, `pkg/chunkserver/` |

## 2. Core Architectural Invariants

1. **Pure Storage Core vs. Multi-Tenant Hono + PostgreSQL Application Layer:**
   - **LumaVault Storage Core (`pkg/gateway/`, `pkg/metadata/`, `pkg/chunkstore/`, `pkg/consensus/`, `pkg/chunkserver/`):** Stores **only** content-addressed object manifests (`ObjectMetadata`) and immutable `SHA-256` chunks. The Gateway (`:8080`) talks **only** to `MetadataStore` and `ChunkStore` and verifies requests statelessly via HMAC/Ed25519 **Signed Storage Tickets**—never querying PostgreSQL or holding domain logic.
   - **Headless Multi-Tenant App API & PostgreSQL Layer (`apps/api` `:4000` + `docker-compose.yml` `:5432`):** All authentication (`better-auth` SSO + Bearer), Server Super-Admin household allowances/quotas, cross-household RBAC grants (`iam`), external metadata (`TMDB`, `IGDB`), background media/retention workers, and mutable domain state (`photos`, `cinema`, `arcade` Drizzle schemas) live in PostgreSQL behind the headless **Node.js + Hono** Connect-RPC server (`apps/api`), referencing `lumavault_object_id`.
   - **Pure Client Frontends (`apps/portal`, `apps/{photos,cinema,arcade}/web` Vite SPAs + `apple/` SwiftUI):** Web apps are pure client-side Vite + React 19 + TanStack Router/Query SPAs (zero SSR servers in prod), sharing headless hooks/primitives from `@lumavault/ui` while maintaining independent visual design systems.
2. **Content-Addressed Chunks (`4MB–64MB` over Raw HTTP) & Household Isolation:** Raw media bytes never enter `MetadataStore`, PostgreSQL, `apps/api` client proxy paths, the Paxos log, or Protobuf messages. Multi-tenant uploads commit with `skip_dedup = true` at the Storage Core (so each household owns an isolated `ObjectMetadata` manifest while `ChunkStore` still deduplicates 100% of identical `SHA-256` chunks on disk via `chunkRefs`).
3. **Dual Client Support (Web + Swift via Connect-RPC + Raw HTTP Data Plane):** `connectrpc/go` on `:8080` (`StorageService`) and `@connectrpc/connect` on `:4000` (`IamService`, `PhotosService`, `CinemaService`, `ArcadeService`) serve both `@lumavault/sdk` (`sdk/web`) and `LumaVaultSDK` (`sdk/swift`) from a single `buf generate` pipeline.
4. **No Media in Git:** Never commit copyrighted media, ROMs, BIOS files, or `.env` secrets to the repository.

## 3. Code Conventions (All Languages)

1. **No Markdown syntax in code comments, ever.** No backticks, `**bold**`, `_italics_`, `#` headings, `[links](...)`, or bullet lists inside `//`, `/** */`, `///`, or `#` comments (Go, TypeScript, Swift, Protobuf, shell). Write identifiers and paths as plain text: `Uploads via PUT /v1/chunks/{sha256} and returns the stored size.` not ``Uploads via `PUT /v1/chunks/{sha256}`...``. Markdown belongs only in `.md` files.
2. **Keep files focused, without over-splitting.** Prefer a few cohesive files over many tiny ones. Split a file when it mixes unrelated concerns or grows past roughly 300 lines of non-test code.
   - Public contracts and types live apart from implementations when a package has more than one implementation (mirror `pkg/chunkstore/store.go` vs `local.go`, `pkg/metadata/store.go` vs `engine.go` vs `local.go`).
   - Constants live in a constants file or package, never inline in core logic.
   - Validation, URL building, HTTP/body helpers, and other utilities get their own module once they are shared or large. A small helper with one caller can stay beside it.
   - One canonical implementation per helper (one hash validator, one object ID validator, one fetch resolver). Do not duplicate helpers across files with drifting rules.
   - One public entrypoint per package (`index.ts`, the Go package itself). Internal modules do not re-export each other's symbols.
   - In `apps/api`, import across folders with the `#/` alias (for example `#/auth/role-checks.js`), never `../`. Keep `./` for files in the same folder. The `.js` ending is required: Node runs the compiled files, so the specifier names the output file. Compiled output must run through `pnpm start`, which passes `--conditions=@lumavault/dist` so the alias points at `dist/`.
3. **Database queries live in `apps/api/src/data/`.** Routers, guards, and workers never write Drizzle queries inline.
   - Layout: `data/<schema>/<table>/<verb>-<thing>.ts`, where schema is one of `auth`, `iam`, `photos`, `cinema`, `arcade`. A file holds the related functions for one operation on that table, for example `getHouseholdByUserId` and `getHouseholdById` in `data/iam/household/get-household.ts`. Verbs are `create`, `get`, `update`, `delete`.
   - Types shared by a table's functions live in a `types.ts` in the same folder.
   - Every function, not every file, takes `db: DbOrTx` as its first parameter, with no default. Callers pass the pool, or the `tx` inside `db.transaction(async (tx) => ...)`, so several queries can commit together.
4. **The user makes design decisions, not the agent.** Whenever work reaches a fork (API shape, error model, wire contract, file/module layout, dependency choice, default values, naming of public symbols, behavior the spec does not pin down), stop and ask a clarifying question with the concrete options and their trade-offs before writing code. Do not pick a default silently and move on, and do not invent wire contracts (HTTP response bodies, headers, error strings) that the Gateway or `proto/` does not already define.

## 4. Writing Style (Docs, Issues, Comments)

Write so a reader new to the area understands it on the first read. Simple beats complete; the reader can always ask.

**Docs and issues**
- Open with one or two sentences: what this is and why it matters.
- Use short, plain sentences. One idea per bullet.
- Describe behavior and outcomes, not implementation. Leave function names, option names, and internal file layout to whoever builds it, unless they are a shared contract.
- Use backticks only for paths, commands, and names that must be typed exactly. Write "4 MiB chunks" and "SHA-256", not `4 MiB` and `SHA-256`.
- Use bold rarely. Do not bold every bullet label.
- Define an unfamiliar term once, in plain words, the first time it appears.
- An issue fits on one screen. If it does not, split it.
- Size each issue as one reviewable PR with one concern: one flow, one group of tables, one group of RPCs, or one page. That is usually 2 to 5 owned files.
- Keep setup and plumbing in separate issues from business logic, and give each business flow its own issue.

Issue template:

```
Goal: one or two sentences.

Owned paths: list of paths.

What to build:
- 3 to 6 short bullets describing behavior.

Done when:
- 2 to 5 checks anyone can verify.
```

**Linear and PR comments**
- One point per comment, in two to four sentences: what is wrong, why it matters, what to change.
- No headers, tables, or nested bullets in a comment.

**Code comments**
- Explain why, not what. If the code already says it, skip the comment.
- Keep it to one line when possible, and follow the no-Markdown rule in section 3.

**Example**

Too dense:
> **Streaming Chunker & SHA-256 Hasher (`src/chunker.ts`)**: Implement `prepareChunkPlan(input, options)` for `Blob`/`File` and `Uint8Array`, returning `{ sizeBytes, chunkSizeBytes, sha256Digest, chunks }` with lazy zero-copy chunk views...

Better:
> Split a file into fixed-size chunks and hash each one, without loading the whole file into memory. Large videos (50 GB+) must work in a browser tab.

## 5. Standard Commands

- `make proto` — Run `buf lint` and `buf generate` (Go, Swift, and TypeScript/Connect-ES stubs).
- `make lint` — Run `buf lint`, `go vet ./...`, and SDK/workspace static checks.
- `make test` — Run Go unit/integration tests (`go test -race ./...`) and SDK/app tests.
- `make build` — Compile `cmd/lumavault` and workspace packages.
- `make dev` — Run the Gateway, API, and Portal with development settings, against Postgres and Mailpit from `docker compose up -d`. Ctrl-C stops it.
- `DB_SCHEMA=<schema> pnpm --filter @lumavault/api db:generate` — Write a migration for one Postgres schema after changing its table files. Commit the generated SQL with the table change. The API applies pending migrations when it starts.

## 6. Ticket Workflow (Branch, PR, Linear)

Linear's GitHub integration handles issue status and PR links automatically when the branch name matches the issue's `gitBranchName`: the PR is linked, the issue moves to In Progress / In Review, and to Done on merge. Do not update status or attach PR links by hand.

1. **Branch first.** Before editing repo files, get the issue's `gitBranchName` (`get_issue`; ask the user which `LUM-XX` if unclear) and run `git fetch origin && git checkout -B <gitBranchName> origin/main`. Work with no issue (tooling, docs, CI) uses `chore/<slug>`, `docs/<slug>`, or `ci/<slug>` instead. `.githooks/` rejects any other branch name and any commit or push to `main` (enable with `git config core.hooksPath .githooks`).
2. **Verify.** Run `make lint` and `make test`.
3. **Commit.** Every commit message and PR title uses one of these forms. Add the Linear issue ID in parentheses when there is one.
   - `feat(<feature>): <description> (<ticket>)` for new behavior, for example `feat(web-sdk): add chunk planning and hashing (LUM-21)`.
   - `chore: <description> (<ticket>)` for tooling, CI, dependencies, and cleanup.
   - `docs: <description> (<ticket>)` for documentation only.
4. **Open a PR.** `git push -u origin HEAD`, then `gh pr create` with a title in the same format. Leave it open for user review and CI. Never push to `main` or merge your own PR.
