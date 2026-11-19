// Postgres schemas, one per owner, in the order their migrations run. auth belongs to Better
// Auth, iam to IamService, and the rest to one media app each. iam refers to auth tables, and
// the apps may refer to both, so auth always migrates first.
export const DB_SCHEMAS = ["auth", "iam", "photos", "cinema", "arcade"] as const;
export type DbSchema = (typeof DB_SCHEMAS)[number];

// Matches the defaults in docker-compose.yml. Tests create throwaway databases on this server.
export const DEFAULT_TEST_DATABASE_URL = "postgres://lumavault:lumavault@localhost:5432/lumavault";

// Postgres advisory lock held while migrating, so API processes starting together apply each
// migration once.
export const MIGRATION_LOCK_KEY = 0x4c554d41;

// Each schema's migrations live in migrations/<schema>/ under the API package, and its record
// of applied migrations is this table inside the same schema.
export const MIGRATIONS_DIR_NAME = "migrations";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

// Prefixes for databases created by tests, so leftovers are easy to spot and drop. Each test
// run migrates one template and every test file copies it.
export const TEST_DATABASE_PREFIX = "lv_test_";
export const TEST_TEMPLATE_PREFIX = "lv_tmpl_";

// How many times a test file retries copying the template while other files are copying it.
export const TEMPLATE_BUSY_RETRIES = 100;

// Drizzle table files live under this folder. A schema's tables are in <schema>.ts, in the
// <schema>/ subfolder, or both.
export const SCHEMAS_DIR_NAME = "schemas";
