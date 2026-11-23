import { randomUUID } from "node:crypto";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import { DB_SCHEMAS, DEFAULT_TEST_DATABASE_URL, TEST_DATABASE_PREFIX } from "#/db/constants.js";
import { createDatabase, type Database, loadSchemaModules } from "#/db/index.js";

// Postgres error code sent to connections ended by drop database with (force).
const ADMIN_SHUTDOWN = "57P01";

export interface TestDatabase extends Database {
  url: string;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

/**
 * Creates an empty database on the TEST_DATABASE_URL server. Each test file gets its own,
 * so parallel runs and parallel worktrees never share data.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = TEST_DATABASE_PREFIX + randomUUID().replaceAll("-", "").slice(0, 20);
  await withServer(serverUrl, (c) => c.query(`create database "${name}"`));

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString());
  // pool.end resolves before sockets close, so the forced drop below can kill a closing client.
  database.pool.on("connect", (client) => client.on("error", ignoreAdminShutdown));
  return {
    ...database,
    url: url.toString(),
    async drop() {
      await database.close();
      await withServer(serverUrl, (c) => c.query(`drop database if exists "${name}" with (force)`));
    },
  };
}

function ignoreAdminShutdown(err: Error & { code?: string }): void {
  if (err.code !== ADMIN_SHUTDOWN) throw err;
}

async function withServer<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Creates every schema and table declared under src/db/schemas in a test database. */
export async function pushAllSchemas(database: Database): Promise<void> {
  const push = await pushSchema(await loadSchemaModules(), database.db, [...DB_SCHEMAS]);
  await push.apply();
}
