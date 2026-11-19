// Vitest global setup: migrates one template database per test run, so each test file can
// copy it instead of building every table itself. Dropped again when the run ends.
import { randomUUID } from "node:crypto";
import type { TestProject } from "vitest/node";
import { DEFAULT_TEST_DATABASE_URL, TEST_TEMPLATE_PREFIX } from "./constants.js";
import { createDatabase } from "./index.js";
import { migrateAll } from "./migrate.js";
import { databaseUrl, withServer } from "./server.js";

declare module "vitest" {
  export interface ProvidedContext {
    templateDatabase: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const serverUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = TEST_TEMPLATE_PREFIX + randomUUID().replaceAll("-", "").slice(0, 20);
  await withServer(serverUrl, (c) => c.query(`create database "${name}"`));
  try {
    // Postgres copies a template only while nobody is connected to it, so the pool closes first.
    const database = createDatabase(databaseUrl(serverUrl, name));
    try {
      await migrateAll(database.pool);
    } finally {
      await database.close();
    }
  } catch (err) {
    await withServer(serverUrl, (c) => c.query(`drop database if exists "${name}" with (force)`));
    throw err;
  }
  project.provide("templateDatabase", name);
  return async () => {
    await withServer(serverUrl, (c) => c.query(`drop database if exists "${name}" with (force)`));
  };
}
