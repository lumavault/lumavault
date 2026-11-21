import { Code, ConnectError } from "@connectrpc/connect";
import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds } from "#/db/schemas/iam.js";
import { IAM_APPS, SETUP_STORAGE_CAP_BYTES } from "#/iam/constants.js";
import { createApp } from "#/server/app.js";
import { loadModules, type ModuleContext } from "#/server/modules.js";
import { createTestContext, signUp } from "#test/support/context.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#test/support/db.js";
import { iamClient } from "#test/support/rpc.js";

interface Server {
  database: TestDatabase;
  ctx: ModuleContext;
  app: Hono;
}

const servers: Server[] = [];

// Setup closes for good once it runs, so each scenario gets its own fresh database.
async function freshServer(env: Record<string, string> = {}): Promise<Server> {
  const database = await createTestDatabase();
  await pushAllSchemas(database);
  const ctx = createTestContext(database, { env });
  const server = { database, ctx, app: createApp(ctx, await loadModules()) };
  servers.push(server);
  return server;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.database.drop()));
});

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

const setup = { name: "Root", email: "root@example.com", password: "correct horse battery", householdName: "Home" };

/** Runs setup and returns headers carrying the session cookie it set. */
async function completeSetup(app: Hono, input = setup): Promise<Headers> {
  let setCookie: string[] = [];
  await iamClient(app).completeSetup(input, { onHeader: (h) => (setCookie = h.getSetCookie()) });
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie });
}

describe("first-run setup", () => {
  let server: Server;

  beforeAll(async () => {
    server = await freshServer();
  });

  it("reports that setup is needed on a fresh install", async () => {
    expect(await iamClient(server.app).getSetupStatus({})).toMatchObject({ needsSetup: true, adminEmailRequired: false });
  });

  it("rejects bad input before touching anything", async () => {
    const client = iamClient(server.app);
    expect(await codeOf(client.completeSetup({ ...setup, password: "short" }))).toBe(Code.InvalidArgument);
    expect(await codeOf(client.completeSetup({ ...setup, name: "  " }))).toBe(Code.InvalidArgument);
    expect(await codeOf(client.completeSetup({ ...setup, householdName: "" }))).toBe(Code.InvalidArgument);
    expect(await codeOf(client.completeSetup({ ...setup, email: "not-an-email" }))).toBe(Code.InvalidArgument);
    expect((await iamClient(server.app).getSetupStatus({})).needsSetup).toBe(true);
  });

  it("makes exactly one admin when three calls race", async () => {
    const results = await Promise.all(
      ["a", "b", "c"].map((who) => codeOf(iamClient(server.app).completeSetup({ ...setup, email: `${who}@example.com` }))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === Code.FailedPrecondition)).toHaveLength(2);
    const users = await server.database.db.select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe(SUPER_ADMIN_ROLE);
  });

  it("stays closed afterwards", async () => {
    expect((await iamClient(server.app).getSetupStatus({})).needsSetup).toBe(false);
    expect(await codeOf(iamClient(server.app).completeSetup({ ...setup, email: "late@example.com" }))).toBe(Code.FailedPrecondition);
  });
});

describe("the setup response", () => {
  let server: Server;
  let headers: Headers;

  beforeAll(async () => {
    server = await freshServer();
    headers = await completeSetup(server.app, { ...setup, email: "Root@Example.com" });
  });

  it("signs the browser in as a Super-Admin who owns a household with every app", async () => {
    const viewer = await iamClient(server.app, headers).getViewer({});
    expect(viewer.user).toMatchObject({ email: "root@example.com", isSuperAdmin: true });
    expect(viewer.role).toBe(Role.OWNER);
    expect(viewer.household).toMatchObject({ name: "Home", ownerUserId: viewer.user?.id, suspended: false });
    expect(viewer.household?.allowance).toMatchObject({
      storageCapBytes: SETUP_STORAGE_CAP_BYTES,
      enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
      memberLimit: 4,
    });
    expect(viewer.household?.allowance?.enabledApps).toHaveLength(IAM_APPS.length);
    expect(viewer.usage).toMatchObject({ usedBytes: 0n, reservedBytes: 0n, remainingBytes: SETUP_STORAGE_CAP_BYTES, heldBytes: 0n });
  });

  it("lets the admin sign in again with the same password", async () => {
    const res = await server.ctx.auth.api.signInEmail({ body: { email: "root@example.com", password: setup.password } });
    expect(res.token).toBeTruthy();
  });

  it("lets the new admin upload right away", async () => {
    const res = await iamClient(server.app, headers).prepareUpload({ app: App.CINEMA, sizeBytes: 100n });
    expect(res.uploadTicket).toBeTruthy();
  });
});

describe("a preset admin email", () => {
  let server: Server;

  beforeAll(async () => {
    server = await freshServer({ LUMAVAULT_ADMIN_EMAIL: "owner@example.com" });
  });

  it("is reported and enforced, ignoring case", async () => {
    expect((await iamClient(server.app).getSetupStatus({})).adminEmailRequired).toBe(true);
    expect(await codeOf(iamClient(server.app).completeSetup({ ...setup, email: "someone@example.com" }))).toBe(Code.PermissionDenied);
    expect(await codeOf(iamClient(server.app).completeSetup({ ...setup, email: "Owner@Example.com" }))).toBe("ok");
  });
});

describe("GetViewer", () => {
  let server: Server;
  let adminHeaders: Headers;
  let householdId: string;

  beforeAll(async () => {
    server = await freshServer();
    adminHeaders = await completeSetup(server.app);
    householdId = (await iamClient(server.app, adminHeaders).getViewer({})).household!.id;
  });

  it("requires a session, and works over GET", async () => {
    expect(await codeOf(iamClient(server.app).getViewer({}))).toBe(Code.Unauthenticated);
    const viewer = await iamClient(server.app, adminHeaders, { useHttpGet: true }).getViewer({});
    expect(viewer.user?.isSuperAdmin).toBe(true);
  });

  it("returns no household for someone in none", async () => {
    const outsider = await signUp(server.ctx, "outsider@example.com");
    const viewer = await iamClient(server.app, outsider.headers).getViewer({});
    expect(viewer.user).toMatchObject({ email: "outsider@example.com", isSuperAdmin: false });
    expect(viewer.household).toBeUndefined();
    expect(viewer.usage).toBeUndefined();
    expect(viewer.role).toBe(Role.UNSPECIFIED);
    expect(viewer.gracePeriod).toBeUndefined();
  });

  it("floors remaining bytes at zero and reports held bytes and grace periods", async () => {
    const leaver = await signUp(server.ctx, "leaver@example.com");
    const deleteAt = new Date("2030-01-01T00:00:00Z");
    await server.database.db.insert(iamGracePeriods).values({ userId: leaver.id, householdId, householdName: "Home", heldBytes: 7n, deleteAt });
    await server.database.db
      .update(iamHouseholds)
      .set({ storageCapBytes: 10n, usedBytes: 50n, reservedBytes: 0n })
      .where(eq(iamHouseholds.householdId, householdId));

    const admin = await iamClient(server.app, adminHeaders).getViewer({});
    expect(admin.usage).toMatchObject({ usedBytes: 50n, remainingBytes: 0n, heldBytes: 7n });

    const viewer = await iamClient(server.app, leaver.headers).getViewer({});
    expect(viewer.household).toBeUndefined();
    expect(viewer.gracePeriod).toMatchObject({ formerHouseholdName: "Home", privateBytes: 7n });
    expect(viewer.gracePeriod?.deleteAt?.seconds).toBe(BigInt(deleteAt.getTime() / 1000));
  });

  it("still answers while the household is suspended", async () => {
    await server.database.db.update(iamHouseholds).set({ suspended: true }).where(eq(iamHouseholds.householdId, householdId));
    const viewer = await iamClient(server.app, adminHeaders).getViewer({});
    expect(viewer.household?.suspended).toBe(true);
    expect(viewer.role).toBe(Role.OWNER);
  });
});
