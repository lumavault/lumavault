import { Code, ConnectError } from "@connectrpc/connect";
import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { user } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#/db/testing.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, signUp } from "#/testing/context.js";
import { iamClient } from "#/testing/rpc.js";

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function freshApp(env: Record<string, string> = {}) {
  const database = await createTestDatabase();
  await pushAllSchemas(database);
  const ctx = createTestContext(database, { env });
  return { database, ctx, app: createApp(ctx, await loadModules()) };
}

const setupRequest = (email = "root@example.com") => ({
  name: "Root",
  email,
  password: "correct horse battery",
  householdName: "Root's Home",
});

describe("first-run setup", () => {
  let database: TestDatabase;
  let app: Hono;

  beforeAll(async () => {
    ({ database, app } = await freshApp());
  });
  afterAll(async () => {
    await database?.drop();
  });

  it("makes exactly one admin when two setup calls race", async () => {
    const anon = iamClient(app);
    expect(await anon.getSetupStatus({})).toMatchObject({ needsSetup: true, adminEmailRequired: false });

    const results = await Promise.all([
      codeOf(anon.completeSetup(setupRequest("a@example.com"))),
      codeOf(anon.completeSetup(setupRequest("b@example.com"))),
      codeOf(anon.completeSetup(setupRequest("c@example.com"))),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === Code.FailedPrecondition)).toHaveLength(2);

    const admins = await database.db.select().from(user).where(eq(user.role, "admin"));
    expect(admins).toHaveLength(1);
    const users = await database.db.select({ n: sql<number>`count(*)::int` }).from(user);
    expect(users[0]?.n).toBe(1);
    expect(await anon.getSetupStatus({})).toMatchObject({ needsSetup: false });
  });
});

describe("setup result", () => {
  it("signs the admin in, in a household with every app", async () => {
    const { database, app } = await freshApp();
    try {
      let cookies: string[] = [];
      const res = await app.request("/api/rpc/lumavault.iam.v1.IamService/CompleteSetup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setupRequest()),
      });
      expect(res.status).toBe(200);
      cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
      expect(cookies.join(";")).toMatch(/session_token=/);

      const viewer = await iamClient(app, new Headers({ cookie: cookies.join("; ") })).getViewer({});
      expect(viewer.user).toMatchObject({ email: "root@example.com", isSuperAdmin: true });
      expect(viewer.memberships).toHaveLength(1);
      expect(viewer.memberships[0]?.role).toBe(Role.ADMIN);
      expect(viewer.memberships[0]?.household?.allowance?.enabledApps).toEqual([App.PHOTOS, App.CINEMA, App.ARCADE]);
      expect(viewer.activeHouseholdId).toBe(viewer.memberships[0]?.household?.id);
    } finally {
      await database.drop();
    }
  });

  it("only accepts the preset admin email when one is set", async () => {
    const { database, app } = await freshApp({ LUMAVAULT_ADMIN_EMAIL: "Owner@Example.com" });
    try {
      const anon = iamClient(app);
      expect(await anon.getSetupStatus({})).toMatchObject({ adminEmailRequired: true });
      expect(await codeOf(anon.completeSetup(setupRequest("someone@example.com")))).toBe(Code.PermissionDenied);
      expect(await codeOf(anon.completeSetup(setupRequest("owner@example.com")))).toBe("ok");
    } finally {
      await database.drop();
    }
  });

  it("rejects missing fields", async () => {
    const { database, app } = await freshApp();
    try {
      expect(await codeOf(iamClient(app).completeSetup({ ...setupRequest(), householdName: " " }))).toBe(Code.InvalidArgument);
    } finally {
      await database.drop();
    }
  });
});

describe("viewer", () => {
  let database: TestDatabase;
  let ctx: ModuleContext;
  let app: Hono;

  beforeAll(async () => {
    ({ database, ctx, app } = await freshApp());
  });
  afterAll(async () => {
    await database?.drop();
  });

  it("lists households and switches the active one", async () => {
    const ada = await signUp(ctx, "ada@example.com");
    const home = await createHouseholdFor(ctx, ada.id, "Home");
    const cabin = await createHouseholdFor(ctx, ada.id, "Cabin");
    await database.db.insert(iamHouseholds).values([
      { householdId: home.id, storageCapBytes: 100n, usedBytes: 30n, reservedBytes: 20n, enabledApps: ["photos"] },
      { householdId: cabin.id, storageCapBytes: 10n, usedBytes: 50n, enabledApps: ["cinema"] },
    ]);
    const client = iamClient(app, ada.headers);

    const first = await client.setActiveHousehold({ householdId: home.id });
    expect(first.viewer?.memberships.map((m) => m.household?.name)).toEqual(["Cabin", "Home"]);
    expect(first.viewer?.activeHouseholdId).toBe(home.id);
    expect(first.viewer?.activeUsage).toMatchObject({ usedBytes: 30n, reservedBytes: 20n, remainingBytes: 50n });

    await client.setActiveHousehold({ householdId: cabin.id });
    const viewer = await client.getViewer({});
    expect(viewer.activeHouseholdId).toBe(cabin.id);
    // Usage over a lowered cap reports zero remaining, never a negative number.
    expect(viewer.activeUsage).toMatchObject({ usedBytes: 50n, remainingBytes: 0n });
  });

  it("refuses to switch into someone else's household", async () => {
    const bob = await signUp(ctx, "bob@example.com");
    const eve = await signUp(ctx, "eve@example.com");
    const bobs = await createHouseholdFor(ctx, bob.id, "Bob's");
    expect(await codeOf(iamClient(app, eve.headers).setActiveHousehold({ householdId: bobs.id }))).toBe(Code.PermissionDenied);
  });

  it("works for an outside contributor with no household", async () => {
    const guest = await signUp(ctx, "guest@example.com");
    const viewer = await iamClient(app, guest.headers).getViewer({});
    expect(viewer.memberships).toEqual([]);
    expect(viewer.activeHouseholdId).toBe("");
    expect(viewer.activeUsage).toBeUndefined();
  });

  it("is a GET-able call and needs a session", async () => {
    const ada = await signUp(ctx, "getter@example.com");
    expect((await iamClient(app, ada.headers, { useHttpGet: true }).getViewer({})).user?.email).toBe("getter@example.com");
    expect(await codeOf(iamClient(app).getViewer({}))).toBe(Code.Unauthenticated);
  });
});
