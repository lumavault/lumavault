import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { type DrizzleSnapshotJSON, generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_SCHEMAS, type DbSchema, MIGRATIONS_TABLE } from "./constants.js";
import { createDatabase, loadSchemaModules, parseSchemaName, SCHEMAS_DIR } from "./index.js";
import { migrateAll, migrationsFolder } from "./migrate.js";
import { createTestDatabase, type TestDatabase } from "./testing.js";

const MIGRATED = DB_SCHEMAS.filter((s) => existsSync(join(migrationsFolder(s), "meta", "_journal.json")));

/** The table files drizzle.config.ts hands drizzle-kit for one schema. */
async function tablesOf(schema: DbSchema): Promise<Record<string, unknown>> {
  const file = join(SCHEMAS_DIR, `${schema}.ts`);
  const top = existsSync(file) ? ((await import(pathToFileURL(file).href)) as Record<string, unknown>) : {};
  return { ...top, ...(await loadSchemaModules(join(SCHEMAS_DIR, schema))) };
}

async function latestSnapshot(schema: DbSchema): Promise<DrizzleSnapshotJSON> {
  const meta = join(migrationsFolder(schema), "meta");
  const snapshots = (await readdir(meta)).filter((f) => f.endsWith("_snapshot.json")).sort();
  return JSON.parse(await readFile(join(meta, snapshots.at(-1)!), "utf8")) as DrizzleSnapshotJSON;
}

async function journalLength(schema: DbSchema): Promise<number> {
  const journal = JSON.parse(await readFile(join(migrationsFolder(schema), "meta", "_journal.json"), "utf8"));
  return (journal as { entries: unknown[] }).entries.length;
}

async function appliedCount(database: TestDatabase, schema: DbSchema): Promise<number> {
  const res = await database.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(schema)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return res.rows[0]!.n;
}

describe("migrations", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("cover auth and iam", () => {
    expect(MIGRATED).toEqual(expect.arrayContaining(["auth", "iam"]));
  });

  it("build every declared table on a fresh database, and a second run changes nothing", async () => {
    await migrateAll(database.pool);
    for (const schema of MIGRATED) {
      const declared = Object.values((await latestSnapshot(schema)).tables as Record<string, { name: string }>).map((t) => t.name);
      const res = await database.db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = ${schema}`,
      );
      expect(res.rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(declared));
      expect(await appliedCount(database, schema)).toBe(await journalLength(schema));
    }

    await migrateAll(database.pool);
    for (const schema of MIGRATED) {
      expect(await appliedCount(database, schema)).toBe(await journalLength(schema));
    }
  });

  it("apply each migration once when several API processes start together", async () => {
    const fresh = await createTestDatabase();
    const processes = Array.from({ length: 3 }, () => createDatabase(fresh.url));
    try {
      await Promise.all(processes.map((p) => migrateAll(p.pool)));
      for (const schema of MIGRATED) {
        expect(await appliedCount(fresh, schema)).toBe(await journalLength(schema));
      }
    } finally {
      await Promise.all(processes.map((p) => p.close()));
      await fresh.drop();
    }
  });

  it.each(MIGRATED)("match the %s table files, so generating now would produce nothing", async (schema) => {
    const current = generateDrizzleJson(await tablesOf(schema));
    expect(await generateMigration(await latestSnapshot(schema), current)).toEqual([]);
  });

  it("keep iam's baseline to iam objects plus foreign keys to auth", async () => {
    const baseline = await readFile(join(migrationsFolder("iam"), "0000_baseline.sql"), "utf8");
    const statements = baseline.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE (TABLE|TYPE|INDEX "[^"]+" ON|UNIQUE INDEX "[^"]+" ON)|ALTER TABLE) "iam"\./);
      expect(statement.replace(/REFERENCES "auth"\."[^"]+"/g, "")).not.toContain('"auth"');
    }
  });
});

describe("parseSchemaName", () => {
  it("accepts one known schema", () => {
    expect(parseSchemaName(" iam ")).toBe("iam");
  });

  it("rejects a missing or unknown name", () => {
    expect(() => parseSchemaName(undefined)).toThrow(/set DB_SCHEMA to one of auth, iam/);
    expect(() => parseSchemaName("public")).toThrow(/not public/);
  });
});
