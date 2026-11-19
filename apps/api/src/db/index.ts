import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { listSourceFiles } from "#/source-files.js";
import { DB_SCHEMAS, type DbSchema, SCHEMAS_DIR_NAME } from "./constants.js";

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

/** Parses one schema name, such as the DB_SCHEMA variable for drizzle-kit generate. */
export function parseSchemaName(value: string | undefined): DbSchema {
  const name = (value ?? "").trim();
  if (!(DB_SCHEMAS as readonly string[]).includes(name)) {
    throw new Error(`set DB_SCHEMA to one of ${DB_SCHEMAS.join(", ")}${name ? `, not ${name}` : ""}`);
  }
  return name as DbSchema;
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
