import { Code, ConnectError } from "@connectrpc/connect";
import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
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
  const database = await createMigratedTestDatabase();
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
      expect(viewer.role).toBe(Role.OWNER);
      expect(viewer.household?.allowance?.enabledApps).toEqual([App.PHOTOS, App.CINEMA, App.ARCADE]);
      expect(viewer.household?.ownerUserId).toBe(viewer.user?.id);
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

  it("returns the viewer's one household, role, and usage, with bytes held for removed members", async () => {
    const ada = await signUp(ctx, "ada@example.com");
    const home = await createHouseholdFor(ctx, ada.id, "Home");
    await database.db.insert(iamHouseholds).values({ householdId: home.id, storageCapBytes: 100n, usedBytes: 30n, reservedBytes: 20n, enabledApps: ["photos"] });
    const gone = await signUp(ctx, "gone@example.com");
    await database.db.insert(iamGracePeriods).values({ userId: gone.id, householdId: home.id, householdName: "Home", heldBytes: 7n, deleteAt: new Date(Date.now() + 86_400_000) });

    const viewer = await iamClient(app, ada.headers).getViewer({});
    expect(viewer.household).toMatchObject({ id: home.id, name: "Home", ownerUserId: ada.id });
    expect(viewer.role).toBe(Role.OWNER);
    expect(viewer.usage).toMatchObject({ usedBytes: 30n, reservedBytes: 20n, remainingBytes: 50n, heldBytes: 7n });
    expect(viewer.gracePeriod).toBeUndefined();

    // A removed member sees their grace period and no household.
    const theirs = await iamClient(app, gone.headers).getViewer({});
    expect(theirs.household).toBeUndefined();
    expect(theirs.gracePeriod).toMatchObject({ formerHouseholdName: "Home", privateBytes: 7n });
  });

  it("reports zero remaining, never a negative number, over a lowered cap", async () => {
    const bea = await signUp(ctx, "bea@example.com");
    const cabin = await createHouseholdFor(ctx, bea.id, "Cabin");
    await database.db.insert(iamHouseholds).values({ householdId: cabin.id, storageCapBytes: 10n, usedBytes: 50n, enabledApps: ["cinema"] });
    expect((await iamClient(app, bea.headers).getViewer({})).usage).toMatchObject({ usedBytes: 50n, remainingBytes: 0n });
  });

  it("works for someone with no household", async () => {
    const guest = await signUp(ctx, "guest@example.com");
    const viewer = await iamClient(app, guest.headers).getViewer({});
    expect(viewer.household).toBeUndefined();
    expect(viewer.role).toBe(Role.UNSPECIFIED);
    expect(viewer.usage).toBeUndefined();
  });

  it("is a GET-able call and needs a session", async () => {
    const ada = await signUp(ctx, "getter@example.com");
    expect((await iamClient(app, ada.headers, { useHttpGet: true }).getViewer({})).user?.email).toBe("getter@example.com");
    expect(await codeOf(iamClient(app).getViewer({}))).toBe(Code.Unauthenticated);
  });
});
