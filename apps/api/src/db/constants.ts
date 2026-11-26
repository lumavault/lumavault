// Postgres schemas, one per owner. auth belongs to Better Auth, iam to IamService, and the
// rest to one media app each, so parallel worktrees never push into each other's tables.
export const DB_SCHEMAS = ['auth', 'iam', 'photos', 'cinema', 'arcade'] as const
export type DbSchema = (typeof DB_SCHEMAS)[number]

// Matches the defaults in docker-compose.yml. Tests create throwaway databases on this server.
export const DEFAULT_TEST_DATABASE_URL =
  'postgres://lumavault:lumavault@localhost:5432/lumavault'

// Serializes concurrent schema creation, since CREATE SCHEMA IF NOT EXISTS can still race.
export const SCHEMA_SETUP_LOCK_KEY = 0x4c554d41

// Prefix for databases created by tests, so leftovers are easy to spot and drop.
export const TEST_DATABASE_PREFIX = 'lv_test_'

// Drizzle table files live under this folder, in any subfolder.
export const SCHEMAS_DIR_NAME = 'schemas'

// Largest signed 64-bit integer a Postgres bigint column holds.
export const MAX_PG_BIGINT = 2n ** 63n - 1n
