import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSchemaModules } from "./index.js";
import * as namespaces from "./schemas/namespaces.js";
import { createMigratedTestDatabase } from "./testing.js";

describe("test databases", () => {
  it("start as a copy of the migrated template, with every schema", async () => {
    const fresh = await createMigratedTestDatabase();
    try {
      const res = await fresh.db.execute<{ nspname: string }>(sql`select nspname from pg_namespace`);
      expect(res.rows.map((r) => r.nspname)).toEqual(expect.arrayContaining(["auth", "iam"]));
      const users = await fresh.db.execute(sql`select count(*)::int as n from auth.user`);
      expect(users.rows[0]).toEqual({ n: 0 });
    } finally {
      await fresh.drop();
    }
  });

  it("do not share data", async () => {
    const [a, b] = await Promise.all([createMigratedTestDatabase(), createMigratedTestDatabase()]);
    try {
      await a.db.execute(sql`insert into iam.instance_settings default values`);
      const res = await b.db.execute(sql`select count(*)::int as n from iam.instance_settings`);
      expect(res.rows[0]).toEqual({ n: 0 });
    } finally {
      await Promise.all([a.drop(), b.drop()]);
    }
  });
});

describe("loadSchemaModules", () => {
  let dir: string;

  it("loads the real schema folder, including the shared namespaces", async () => {
    expect(await loadSchemaModules()).toMatchObject({ photosSchema: namespaces.photosSchema });
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lv-schemas-"));
    await mkdir(join(dir, "iam"));
    await writeFile(join(dir, "top.js"), "export const top = 1;\n");
    await writeFile(join(dir, "iam", "nested.js"), "export const nested = 2;\n");
    await writeFile(join(dir, "iam", "skip.test.js"), "export const skipped = 3;\n");
    await writeFile(join(dir, "types.d.ts"), "export declare const typesOnly: 4;\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads files in subfolders and skips tests and declarations", async () => {
    expect(await loadSchemaModules(dir)).toEqual({ top: 1, nested: 2 });
  });

  it("rejects the same export name in two files", async () => {
    await writeFile(join(dir, "iam", "dupe.js"), "export const top = 5;\n");
    await expect(loadSchemaModules(dir)).rejects.toThrow(/top is defined twice/);
    await rm(join(dir, "iam", "dupe.js"));
  });

  it("returns nothing when the folder does not exist", async () => {
    expect(await loadSchemaModules(join(dir, "missing"))).toEqual({});
  });
});
