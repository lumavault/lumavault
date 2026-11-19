import { Code, ConnectError } from "@connectrpc/connect";
import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { verifyTicket } from "#/auth/tickets.js";
import { user } from "#/db/schemas/auth.js";
import { iamHouseholds, iamUploadReservations } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, signUp, type TestUser } from "#/testing/context.js";
import { iamClient } from "#/testing/rpc.js";
import { createSweeper } from "#/workers/iam-sweeper.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let owner: TestUser;
let householdId: string;

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function reserved(): Promise<bigint> {
  const [h] = await database.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  return h!.reservedBytes;
}

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  ctx = createTestContext(database);
  app = createApp(ctx, await loadModules());

  admin = await signUp(ctx, "admin@example.com");
  member = await signUp(ctx, "member@example.com");
  outsider = await signUp(ctx, "friend@example.com");
  owner = await signUp(ctx, "owner@example.com");
  await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, owner.id));

  householdId = (await createHouseholdFor(ctx, admin.id, "Home")).id;
  await database.db.insert(iamHouseholds).values({ householdId, storageCapBytes: 1000n, enabledApps: ["photos"] });
  await ctx.auth.api.addMember({ body: { userId: member.id, organizationId: householdId, role: "member" } });
});

afterAll(async () => {
  await database?.drop();
});

describe("PrepareUpload", () => {
  it("reserves against the active household and returns a matching upload ticket", async () => {
    const before = await reserved();
    const res = await iamClient(app, admin.headers).prepareUpload({ app: App.PHOTOS, sizeBytes: 100n });
    expect(await reserved()).toBe(before + 100n);
    expect(verifyTicket(ctx.config.ticketSecret, res.uploadTicket)).toMatchObject({ kind: "up", namespace: 1, maxSizeBytes: 100n });
    expect(res.reservationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("works for Members, billed to the household", async () => {
    const before = await reserved();
    await iamClient(app, member.headers).prepareUpload({ app: App.PHOTOS, sizeBytes: 10n });
    expect(await reserved()).toBe(before + 10n);
  });

  it("does not let a Member upload to the shared library", async () => {
    expect(await codeOf(iamClient(app, member.headers).prepareUpload({ app: App.CINEMA, sizeBytes: 1n, sharedLibrary: true }))).toBe(
      Code.PermissionDenied,
    );
  });

  it("needs a household", async () => {
    expect(await codeOf(iamClient(app, outsider.headers).prepareUpload({ app: App.PHOTOS, sizeBytes: 1n }))).toBe(Code.FailedPrecondition);
    expect(await codeOf(iamClient(app).prepareUpload({ app: App.PHOTOS, sizeBytes: 1n }))).toBe(Code.Unauthenticated);
  });

  it("lets the Super-Admin upload to the shared library without billing anyone", async () => {
    const before = await reserved();
    const res = await iamClient(app, owner.headers).prepareUpload({
      app: App.CINEMA,
      sizeBytes: 10n ** 12n,
      sharedLibrary: true,
    });
    expect(verifyTicket(ctx.config.ticketSecret, res.uploadTicket)).toMatchObject({ namespace: 2 });
    expect(await reserved()).toBe(before);
  });

  it("rejects a missing app or size", async () => {
    const asAdmin = iamClient(app, admin.headers);
    expect(await codeOf(asAdmin.prepareUpload({ sizeBytes: 1n }))).toBe(Code.InvalidArgument);
    expect(await codeOf(asAdmin.prepareUpload({ app: App.PHOTOS, sizeBytes: 0n }))).toBe(Code.InvalidArgument);
  });
});

describe("CancelUpload", () => {
  it("gives the bytes back, once", async () => {
    const asAdmin = iamClient(app, admin.headers);
    const before = await reserved();
    const { reservationId } = await asAdmin.prepareUpload({ app: App.PHOTOS, sizeBytes: 50n });
    await asAdmin.cancelUpload({ reservationId });
    await asAdmin.cancelUpload({ reservationId });
    expect(await reserved()).toBe(before);
  });

  it("refuses someone else's reservation", async () => {
    const { reservationId } = await iamClient(app, admin.headers).prepareUpload({ app: App.PHOTOS, sizeBytes: 5n });
    expect(await codeOf(iamClient(app, member.headers).cancelUpload({ reservationId }))).toBe(Code.PermissionDenied);
  });
});

describe("reservation sweeper", () => {
  it("refunds an expired reservation exactly once, then stops cleanly", async () => {
    const { reservationId } = await iamClient(app, admin.headers).prepareUpload({ app: App.PHOTOS, sizeBytes: 77n });
    const before = await reserved();
    await database.db
      .update(iamUploadReservations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(iamUploadReservations.id, reservationId));

    const sweeper = createSweeper(ctx, 5);
    sweeper.start();
    await new Promise((r) => setTimeout(r, 100));
    await sweeper.stop();

    expect(await reserved()).toBe(before - 77n);
    const [row] = await database.db.select().from(iamUploadReservations).where(eq(iamUploadReservations.id, reservationId));
    expect(row?.status).toBe("expired");
  });
});
