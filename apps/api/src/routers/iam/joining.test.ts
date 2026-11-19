import { Code, ConnectError } from "@connectrpc/connect";
import { App, InviteKind, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { member, organization, user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds, iamObjectClaims } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
import type { AppDataHooks } from "#/iam/app-data.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, signUp, type TestUser } from "#/testing/context.js";
import { FakeGateway } from "#/testing/fake-gateway.js";
import { iamClient } from "#/testing/rpc.js";
import { expireGracePeriods } from "#/workers/iam-grace.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let root: TestUser;
const gateway = new FakeGateway();
const calls: string[] = [];

// A stand-in media app: objects named private-* are their uploader's private data, and
// objects named shared-* are shared items of the household that holds them.
const photos: AppDataHooks = {
  app: "photos",
  async privateObjects(c, userId, householdId) {
    const rows = await c.db
      .select()
      .from(iamObjectClaims)
      .where(and(eq(iamObjectClaims.uploadedBy, userId), eq(iamObjectClaims.householdId, householdId), isNull(iamObjectClaims.releasedAt)));
    return rows.filter((r) => r.objectId.startsWith("private-")).map((r) => r.objectId);
  },
  async movePrivateData(_c, userId, from, to) {
    calls.push(`move ${userId} ${from}->${to}`);
  },
  async deletePrivateData(_c, userId) {
    calls.push(`delete ${userId}`);
  },
  async sharedItems(c, householdId) {
    const rows = await c.db
      .select()
      .from(iamObjectClaims)
      .where(and(eq(iamObjectClaims.householdId, householdId), isNull(iamObjectClaims.releasedAt)));
    return rows
      .filter((r) => r.objectId.startsWith("shared-"))
      .map((r) => ({ kind: "album", id: r.objectId, name: r.objectId, sizeBytes: r.bytes, uploadedBy: r.uploadedBy, objectIds: [r.objectId] }));
  },
  async copySharedItems(_c, items, to, userId, copies) {
    calls.push(`copy ${items.map((i) => i.id).join(",")} to ${to} by ${userId} (${copies.size} objects)`);
  },
  async deleteHousehold(_c, householdId) {
    calls.push(`close ${householdId}`);
  },
};

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function household(ownerUser: TestUser, name: string, cap = 1000n): Promise<string> {
  const id = (await createHouseholdFor(ctx, ownerUser.id, name)).id;
  await database.db.insert(iamHouseholds).values({ householdId: id, storageCapBytes: cap, enabledApps: ["photos"] });
  return id;
}

/** Stores an object billed to a household, as if it had been uploaded. */
async function store(householdId: string, objectId: string, uploadedBy: string, bytes: bigint): Promise<void> {
  gateway.put(objectId, 1, bytes);
  await database.db.insert(iamObjectClaims).values({ objectId, householdId, uploadedBy, app: "photos", bytes });
  await database.db
    .update(iamHouseholds)
    .set({ usedBytes: sql`${iamHouseholds.usedBytes} + ${bytes.toString()}::bigint` })
    .where(eq(iamHouseholds.householdId, householdId));
}

async function usedBytes(householdId: string): Promise<bigint | undefined> {
  const [h] = await database.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  return h?.usedBytes;
}

// "gone" when the claim no longer exists, as when its household was closed and deleted.
async function billedTo(objectId: string): Promise<string | null> {
  const [c] = await database.db.select().from(iamObjectClaims).where(eq(iamObjectClaims.objectId, objectId));
  if (!c) return "gone";
  return c.releasedAt ? "released" : c.householdId;
}

async function memberInvite(from: TestUser, to: string, householdId: string): Promise<string> {
  const res = await ctx.auth.api.createInvitation({ body: { email: to, role: "member", organizationId: householdId }, headers: from.headers });
  return res.id;
}

async function householdInvite(to: string, cap = 1000n): Promise<string> {
  const res = await iamClient(app, root.headers).createHouseholdInvite({ email: to, allowance: { storageCapBytes: cap, enabledApps: [App.PHOTOS] } });
  return res.inviteUrl.split("/").at(-1)!;
}

async function addMember(householdId: string, u: TestUser, role = "member"): Promise<void> {
  await database.db.insert(member).values({ id: crypto.randomUUID(), organizationId: householdId, userId: u.id, role, createdAt: new Date() });
}

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  ctx = createTestContext(database, { gateway });
  ctx.apps.push(photos);
  app = createApp(ctx, await loadModules());
  root = await signUp(ctx, "root@example.com");
  await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, root.id));
});

afterAll(async () => {
  await database?.drop();
});

describe("household creation invites", () => {
  it("can be previewed signed out, then redeemed once by the invited email", async () => {
    const token = await householdInvite("newbie@example.com", 500n);
    const preview = await iamClient(app).getInvite({ invite: { invite: { case: "householdInviteToken", value: token } } });
    expect(preview).toMatchObject({ kind: InviteKind.NEW_HOUSEHOLD, email: "newbie@example.com", inviterName: "root", role: Role.OWNER });
    expect(preview.move).toBeUndefined();

    const newbie = await signUp(ctx, "newbie@example.com");
    const stranger = await signUp(ctx, "stranger@example.com");
    const ref = { invite: { case: "householdInviteToken" as const, value: token } };
    expect(await codeOf(iamClient(app, stranger.headers).joinHousehold({ invite: ref, householdName: "Nope" }))).toBe(Code.PermissionDenied);

    const res = await iamClient(app, newbie.headers).joinHousehold({ invite: ref, householdName: "Newbie Nest" });
    expect(res.household).toMatchObject({ name: "Newbie Nest", ownerUserId: newbie.id, allowance: { storageCapBytes: 500n } });
    expect(await codeOf(iamClient(app, newbie.headers).joinHousehold({ invite: ref, householdName: "Again" }))).toBe(Code.FailedPrecondition);
  });
});

describe("moving to another household", () => {
  it("previews the move, carries private data, copies chosen shared items, and leaves the old household its own", async () => {
    const ann = await signUp(ctx, "ann@example.com");
    const bob = await signUp(ctx, "bob@example.com");
    const cat = await signUp(ctx, "cat@example.com");
    const a = await household(ann, "Ann's");
    await addMember(a, bob);
    await store(a, "private-bob-1", bob.id, 30n);
    await store(a, "shared-ann-album", ann.id, 20n);
    const b = await household(cat, "Cat's");
    const inviteId = await memberInvite(cat, "bob@example.com", b);
    const ref = { invite: { case: "memberInviteId" as const, value: inviteId } };

    const preview = await iamClient(app, bob.headers).getInvite({ invite: ref });
    expect(preview).toMatchObject({ kind: InviteKind.MEMBER, householdName: "Cat's", role: Role.MEMBER });
    expect(preview.move).toMatchObject({ privateBytes: 30n, mustChooseNextOwner: false, closesCurrentHousehold: false });
    const items = await iamClient(app, bob.headers).listCopyableItems({});
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({ ref: { app: App.PHOTOS, kind: "album", id: "shared-ann-album" }, sizeBytes: 20n, uploadedByCaller: false });

    calls.length = 0;
    const res = await iamClient(app, bob.headers).joinHousehold({ invite: ref, copyItems: [items.items[0]!.ref!] });
    expect(res.household?.id).toBe(b);
    expect(await billedTo("private-bob-1")).toBe(b);
    expect(await billedTo("shared-ann-album")).toBe(a);
    expect(await usedBytes(a)).toBe(20n);
    expect(await usedBytes(b)).toBe(50n);
    expect(calls).toEqual([`move ${bob.id} ${a}->${b}`, `copy shared-ann-album to ${b} by ${bob.id} (1 objects)`]);
    expect((await iamClient(app, bob.headers).getViewer({})).household?.id).toBe(b);
  });

  it("makes an Owner leaving others behind name the next Owner", async () => {
    const dee = await signUp(ctx, "dee@example.com");
    const eve = await signUp(ctx, "eve@example.com");
    const fay = await signUp(ctx, "fay@example.com");
    const d = await household(dee, "Dee's");
    await addMember(d, eve);
    const f = await household(fay, "Fay's");
    const ref = { invite: { case: "memberInviteId" as const, value: await memberInvite(fay, "dee@example.com", f) } };

    const preview = await iamClient(app, dee.headers).getInvite({ invite: ref });
    expect(preview.move?.mustChooseNextOwner).toBe(true);
    expect(preview.move?.nextOwnerCandidates.map((c) => c.user?.email)).toEqual(["eve@example.com"]);
    expect(await codeOf(iamClient(app, dee.headers).joinHousehold({ invite: ref }))).toBe(Code.FailedPrecondition);

    await iamClient(app, dee.headers).joinHousehold({ invite: ref, nextOwnerUserId: eve.id });
    const [eveRow] = await database.db.select().from(member).where(and(eq(member.organizationId, d), eq(member.userId, eve.id)));
    expect(eveRow?.role).toBe("owner");
  });

  it("closes the old household when its only member moves away", async () => {
    const gus = await signUp(ctx, "gus@example.com");
    const hal = await signUp(ctx, "hal@example.com");
    const g = await household(gus, "Gus's");
    await store(g, "private-gus-1", gus.id, 10n);
    await store(g, "shared-gus-left-behind", gus.id, 5n);
    const h = await household(hal, "Hal's");
    const ref = { invite: { case: "memberInviteId" as const, value: await memberInvite(hal, "gus@example.com", h) } };
    expect((await iamClient(app, gus.headers).getInvite({ invite: ref })).move?.closesCurrentHousehold).toBe(true);

    await iamClient(app, gus.headers).joinHousehold({ invite: ref });
    expect(await billedTo("private-gus-1")).toBe(h);
    expect(await billedTo("shared-gus-left-behind")).toBe("gone");
    expect(gateway.objects.has("shared-gus-left-behind")).toBe(false);
    expect(await database.db.select().from(organization).where(eq(organization.id, g))).toEqual([]);
  });

  it("refuses a move that does not fit, changing nothing", async () => {
    const ivy = await signUp(ctx, "ivy@example.com");
    const jay = await signUp(ctx, "jay@example.com");
    const i = await household(ivy, "Ivy's");
    await store(i, "private-ivy-big", ivy.id, 900n);
    const j = await household(jay, "Jay's", 100n);
    const ref = { invite: { case: "memberInviteId" as const, value: await memberInvite(jay, "ivy@example.com", j) } };
    expect(await codeOf(iamClient(app, ivy.headers).joinHousehold({ invite: ref }))).toBe(Code.ResourceExhausted);
    expect((await iamClient(app, ivy.headers).getViewer({})).household?.id).toBe(i);
    expect(await billedTo("private-ivy-big")).toBe(i);
  });
});

describe("leaving and the grace period", () => {
  it("holds private data after leaving, and moves it when the person joins a household in time", async () => {
    const kim = await signUp(ctx, "kim@example.com");
    const lou = await signUp(ctx, "lou@example.com");
    const mo = await signUp(ctx, "mo@example.com");
    const k = await household(kim, "Kim's");
    await addMember(k, lou);
    await store(k, "private-lou-1", lou.id, 40n);

    await iamClient(app, lou.headers).leaveHousehold({});
    const viewer = await iamClient(app, lou.headers).getViewer({});
    expect(viewer.household).toBeUndefined();
    expect(viewer.gracePeriod).toMatchObject({ formerHouseholdName: "Kim's", privateBytes: 40n });

    const m = await household(mo, "Mo's");
    const ref = { invite: { case: "memberInviteId" as const, value: await memberInvite(mo, "lou@example.com", m) } };
    await iamClient(app, lou.headers).joinHousehold({ invite: ref });
    expect(await billedTo("private-lou-1")).toBe(m);
    expect((await iamClient(app, lou.headers).getViewer({})).gracePeriod).toBeUndefined();
  });

  it("deletes held data once the grace period ends, refunding exactly once, and closes an emptied household", async () => {
    const ned = await signUp(ctx, "ned@example.com");
    const n = await household(ned, "Ned's");
    await store(n, "private-ned-1", ned.id, 60n);
    await iamClient(app, ned.headers).leaveHousehold({});
    expect(await database.db.select().from(organization).where(eq(organization.id, n))).toHaveLength(1);

    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await expireGracePeriods(ctx, later)).toBeGreaterThanOrEqual(1);
    expect(await billedTo("private-ned-1")).toBe("gone");
    expect(gateway.objects.has("private-ned-1")).toBe(false);
    expect(await database.db.select().from(iamGracePeriods).where(eq(iamGracePeriods.userId, ned.id))).toEqual([]);
    expect(await database.db.select().from(organization).where(eq(organization.id, n))).toEqual([]);
    expect(await expireGracePeriods(ctx, later)).toBe(0);
  });
});
