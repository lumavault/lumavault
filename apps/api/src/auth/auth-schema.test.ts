import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as authTables from "#/db/schemas/auth.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#/db/testing.js";
import { createAuth } from "./auth.js";
import { HOUSEHOLD_OWNER_ROLE } from "./constants.js";
import { allowSignUp } from "./sign-up-gate.js";
import { toAuthSchema } from "#/tools/generate-auth-schema.js";

const API_DIR = fileURLToPath(new URL("../../", import.meta.url));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
});

afterAll(async () => {
  await database?.drop();
});

describe("generated auth schema", () => {
  it("matches what the Better Auth CLI generates today", async () => {
    await promisify(execFile)("pnpm", ["auth:check"], { cwd: API_DIR });
  }, 60_000);

  it("refuses CLI output it does not recognize", () => {
    expect(() => toAuthSchema("export const user = {};")).toThrow(/no pgTable calls/);
  });

  it("pushes every table into the auth schema", async () => {
    const res = await database.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'auth' order by table_name`,
    );
    expect(res.rows.map((r) => r.table_name)).toEqual([
      "account",
      "invitation",
      "member",
      "organization",
      "passkey",
      "session",
      "user",
      "verification",
    ]);
  });
});

describe("createAuth", () => {
  it("signs up a user and makes a household creator its owner", async () => {
    const auth = createAuth({
      db: database.db,
      tables: authTables,
      secret: "test-secret-that-is-at-least-32-bytes-long",
      baseURL: "http://localhost:4000",
      trustedOrigins: ["http://localhost:3000"],
      passkeyRpID: "localhost",
      sendMagicLink: async () => {},
      sendPasswordReset: async () => {},
    });

    const signUp = await allowSignUp(() =>
      auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct horse battery" } }),
    );
    expect(signUp.token).toBeTruthy();

    const headers = new Headers({ authorization: `Bearer ${signUp.token}` });
    const household = await auth.api.createOrganization({ body: { name: "Home", slug: "home" }, headers });
    expect(household?.id).toBeTruthy();

    const members = await database.db
      .select()
      .from(authTables.member)
      .where(eq(authTables.member.organizationId, household!.id));
    expect(members).toEqual([expect.objectContaining({ userId: signUp.user.id, role: HOUSEHOLD_OWNER_ROLE })]);
  });
});
