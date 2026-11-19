import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { DB_SCHEMAS, type DbSchema, MIGRATION_LOCK_KEY, MIGRATIONS_DIR_NAME, MIGRATIONS_TABLE } from "./constants.js";

// The package root, two levels up from both src/db and dist/db.
export const MIGRATIONS_DIR = fileURLToPath(new URL(`../../${MIGRATIONS_DIR_NAME}/`, import.meta.url));

export function migrationsFolder(schema: DbSchema): string {
  return join(MIGRATIONS_DIR, schema);
}

/**
 * Applies every pending migration, schema by schema in DB_SCHEMAS order. A schema with no
 * migrations folder yet is skipped. The drizzle migrator creates each schema before recording
 * its first migration there. Holds an advisory lock for the whole run, so processes starting
 * together wait for each other instead of applying the same migration twice.
 */
export async function migrateAll(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const db = drizzle(client);
      for (const schema of DB_SCHEMAS) {
        const folder = migrationsFolder(schema);
        if (!existsSync(join(folder, "meta", "_journal.json"))) {
          continue;
        }
        await migrate(db, { migrationsFolder: folder, migrationsSchema: schema, migrationsTable: MIGRATIONS_TABLE });
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
