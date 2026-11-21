import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { listSourceFiles } from "#/server/source-files.js";
import { DB_SCHEMAS, type DbSchema, SCHEMA_SETUP_LOCK_KEY, SCHEMAS_DIR_NAME } from "./constants.js";

export { DB_SCHEMAS, type DbSchema } from "./constants.js";

export type Db = NodePgDatabase;

/** The pool database, or the transaction object handed to the callback of db.transaction. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Opens a connection pool. Call close on shutdown. */
export function createDatabase(url: string): Database {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool), pool, close: () => pool.end() };
}

/** Creates every LumaVault schema that does not exist yet. Safe to run again and in parallel. */
export async function ensureSchemas(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SCHEMA_SETUP_LOCK_KEY})`);
    for (const schema of DB_SCHEMAS) {
      await tx.execute(sql`create schema if not exists ${sql.identifier(schema)}`);
    }
  });
}

/** Parses a comma-separated schema list, such as the DB_SCHEMA variable. Empty means all. */
export function parseSchemaFilter(value: string | undefined): DbSchema[] {
  const names = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) {
    return [...DB_SCHEMAS];
  }
  for (const name of names) {
    if (!(DB_SCHEMAS as readonly string[]).includes(name)) {
      throw new Error(`unknown schema ${name}; expected one of ${DB_SCHEMAS.join(", ")}`);
    }
  }
  return names as DbSchema[];
}

export const SCHEMAS_DIR = fileURLToPath(new URL(`./${SCHEMAS_DIR_NAME}/`, import.meta.url));

/** Imports every table file under dir, including subfolders, and merges their exports. */
export async function loadSchemaModules(dir: string = SCHEMAS_DIR): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (const file of await listSourceFiles(dir)) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (name in merged && merged[name] !== value) {
        throw new Error(`schema export ${name} is defined twice; rename one (${file})`);
      }
      merged[name] = value;
    }
  }
  return merged;
}
