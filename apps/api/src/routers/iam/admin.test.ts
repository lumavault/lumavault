import { Code, ConnectError } from "@connectrpc/connect";
import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { invitation, user } from "#/db/schemas/auth.js";
import { iamHouseholdInvites, iamHouseholds } from "#/db/schemas/iam.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#/db/testing.js";
import { hashSecret } from "#/iam/secrets.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, recordingEmail, signUp, TEST_WEB_ORIGIN, type TestUser } from "#/testing/context.js";
import { iamClient } from "#/testing/rpc.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let owner: TestUser;
let ada: TestUser;
let householdId: string;
const email = recordingEmail();

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
  ctx = createTestContext(database, { email });
  app = createApp(ctx, await loadModules());
  owner = await signUp(ctx, "owner@example.com");
  await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, owner.id));
  ada = await signUp(ctx, "ada@example.com");
  householdId = (await createHouseholdFor(ctx, ada.id, "Ada's")).id;
  await database.db.insert(iamHouseholds).values({ householdId, storageCapBytes: 1000n, usedBytes: 600n, enabledApps: ["photos"] });
});

afterAll(async () => {
  await database?.drop();
});

describe("Super-Admin only", () => {
  it("rejects everyone else", async () => {
    const asAda = iamClient(app, ada.headers);
    const calls: Promise<unknown>[] = [
      asAda.createHouseholdInvite({}),
      asAda.listHouseholdInvites({}),
      asAda.revokeHouseholdInvite({ inviteId: "x" }),
      asAda.listHouseholds({}),
      asAda.updateHouseholdAllowance({ householdId }),
      asAda.setHouseholdSuspended({ householdId, suspended: true }),
      asAda.listUsers({}),
      asAda.banUser({ userId: owner.id }),
      asAda.unbanUser({ userId: owner.id }),
    ];
    for (const result of await Promise.all(calls.map(codeOf))) {
      expect(result).toBe(Code.PermissionDenied);
    }
    expect(await codeOf(iamClient(app).listHouseholds({}))).toBe(Code.Unauthenticated);
  });
});

describe("household creation invites", () => {
  it("returns the link once, stores only its hash, and can be revoked", async () => {
    const asOwner = iamClient(app, owner.headers);
    email.sent.length = 0;
    const res = await asOwner.createHouseholdInvite({
      email: "Lovelace@Example.com",
      allowance: { storageCapBytes: 5n * 2n ** 40n, enabledApps: [App.PHOTOS, App.CINEMA, App.PHOTOS] },
      note: "for the Lovelaces",
    });
    expect(res.inviteUrl.startsWith(`${TEST_WEB_ORIGIN}/invite/household/`)).toBe(true);
    expect(res.invite?.email).toBe("lovelace@example.com");
    expect(email.sent).toEqual([{ kind: "household-invite", to: "lovelace@example.com", url: res.inviteUrl }]);
    expect(await codeOf(asOwner.createHouseholdInvite({ allowance: { storageCapBytes: 1n } }))).toBe(Code.InvalidArgument);
    expect(res.invite?.allowance).toMatchObject({ memberLimit: 4, enabledApps: [App.PHOTOS, App.CINEMA] });

    const token = res.inviteUrl.split("/").at(-1)!;
    const [row] = await database.db.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.id, res.invite!.id));
    expect(row?.tokenHash).toBe(hashSecret(token));
    expect(JSON.stringify(row, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(token);

    expect((await asOwner.listHouseholdInvites({})).invites.map((i) => i.id)).toContain(res.invite!.id);
    await asOwner.revokeHouseholdInvite({ inviteId: res.invite!.id });
    expect((await asOwner.listHouseholdInvites({})).invites.map((i) => i.id)).not.toContain(res.invite!.id);
    expect(await codeOf(asOwner.revokeHouseholdInvite({ inviteId: "not-a-uuid" }))).toBe(Code.NotFound);
  });
});

describe("households", () => {
  it("lists households with usage and counts, a page at a time", async () => {
    const extra = await signUp(ctx, "extra@example.com");
    await createHouseholdFor(ctx, extra.id, "Extra");
    const asOwner = iamClient(app, owner.headers);
    const first = await asOwner.listHouseholds({ pageSize: 1 });
    expect(first.households).toHaveLength(1);
    expect(first.nextPageToken).not.toBe("");
    const second = await asOwner.listHouseholds({ pageSize: 1, pageToken: first.nextPageToken });
    expect(second.households[0]?.household?.id).not.toBe(first.households[0]?.household?.id);

    const all = await asOwner.listHouseholds({});
    const ours = all.households.find((h) => h.household?.id === householdId);
    expect(ours).toMatchObject({
      memberCount: 1,
      owner: { email: "ada@example.com" },
      household: { ownerUserId: ada.id },
      usage: { usedBytes: 600n, remainingBytes: 400n, heldBytes: 0n },
    });
    expect(await codeOf(asOwner.listHouseholds({ pageToken: "%%%" }))).toBe(Code.InvalidArgument);
  });

  it("changes only the masked fields, even below current usage", async () => {
    const asOwner = iamClient(app, owner.headers);
    const res = await asOwner.updateHouseholdAllowance({
      householdId,
      allowance: { storageCapBytes: 100n, memberLimit: 9, enabledApps: [App.ARCADE] },
      updateMask: { paths: ["storage_cap_bytes", "member_limit"] },
    });
    expect(res.household?.allowance).toMatchObject({ storageCapBytes: 100n, memberLimit: 9, enabledApps: [App.PHOTOS] });
    expect(await codeOf(asOwner.updateHouseholdAllowance({ householdId, updateMask: { paths: [] } }))).toBe(Code.InvalidArgument);
    expect(await codeOf(asOwner.updateHouseholdAllowance({ householdId, updateMask: { paths: ["used_bytes"] } }))).toBe(
      Code.InvalidArgument,
    );
    expect(
      await codeOf(asOwner.updateHouseholdAllowance({ householdId, allowance: { memberLimit: 0 }, updateMask: { paths: ["member_limit"] } })),
    ).toBe(Code.InvalidArgument);
  });

  it("suspends and reactivates", async () => {
    const asOwner = iamClient(app, owner.headers);
    expect((await asOwner.setHouseholdSuspended({ householdId, suspended: true })).household?.suspended).toBe(true);
    expect((await asOwner.setHouseholdSuspended({ householdId, suspended: false })).household?.suspended).toBe(false);
    expect(await codeOf(asOwner.setHouseholdSuspended({ householdId: "missing", suspended: true }))).toBe(Code.NotFound);
  });
});

describe("users", () => {
  it("finds users by name or email", async () => {
    const res = await iamClient(app, owner.headers).listUsers({ query: "ADA@" });
    expect(res.users.map((u) => u.email)).toEqual(["ada@example.com"]);
  });

  it("bans a user: their session stops working at once and their invites are cancelled", async () => {
    const mallory = await signUp(ctx, "mallory@example.com");
    const theirs = await createHouseholdFor(ctx, mallory.id, "Mallory's");
    await ctx.auth.api.createInvitation({ body: { email: "friend@example.com", role: "member", organizationId: theirs.id }, headers: mallory.headers });
    expect((await iamClient(app, mallory.headers).getViewer({})).user?.email).toBe("mallory@example.com");

    const res = await iamClient(app, owner.headers).banUser({ userId: mallory.id, reason: "spam" });
    expect(res.user).toMatchObject({ banned: true, banReason: "spam" });
    expect(await codeOf(iamClient(app, mallory.headers).getViewer({}))).toBe(Code.Unauthenticated);
    const pending = await database.db.select().from(invitation).where(eq(invitation.inviterId, mallory.id));
    expect(pending.map((i) => i.status)).toEqual(["canceled"]);

    expect((await iamClient(app, owner.headers).unbanUser({ userId: mallory.id })).user?.banned).toBe(false);
  });

  it("refuses to ban yourself", async () => {
    expect(await codeOf(iamClient(app, owner.headers).banUser({ userId: owner.id }))).toBe(Code.FailedPrecondition);
  });
});
