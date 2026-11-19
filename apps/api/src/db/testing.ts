import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { inject } from "vitest";
import { DEFAULT_TEST_DATABASE_URL, TEMPLATE_BUSY_RETRIES, TEST_DATABASE_PREFIX } from "./constants.js";
import { isObjectInUse } from "./errors.js";
import { createDatabase, type Database } from "./index.js";
import { databaseUrl, withServer } from "./server.js";

export interface TestDatabase extends Database {
  url: string;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

/**
 * Creates a database on the TEST_DATABASE_URL server. Each test file gets its own, so parallel
 * runs and parallel worktrees never share data. With from set, it starts as a copy of that
 * database; otherwise it is empty.
 */
export async function createTestDatabase(from?: string): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = TEST_DATABASE_PREFIX + randomUUID().replaceAll("-", "").slice(0, 20);
  const create = from ? `create database "${name}" template "${from}"` : `create database "${name}"`;
  await withServer(serverUrl, async (c) => {
    // Postgres refuses to copy a template while another copy of it is starting, so retry.
    for (let attempt = 0; ; attempt++) {
      try {
        return await c.query(create);
      } catch (err) {
        if (!isObjectInUse(err) || attempt >= TEMPLATE_BUSY_RETRIES) {
          throw err;
        }
        await sleep(50 + Math.random() * 100);
      }
    }
  });

  const url = databaseUrl(serverUrl, name);
  const database = createDatabase(url);
  return {
    ...database,
    url,
    async drop() {
      await database.close();
      await withServer(serverUrl, (c) => c.query(`drop database if exists "${name}" with (force)`));
    },
  };
}

/** A copy of this run's migrated template database, with every schema and table in place. */
export function createMigratedTestDatabase(): Promise<TestDatabase> {
  return createTestDatabase(inject("templateDatabase"));
}
