import { Code, ConnectError } from "@connectrpc/connect";
import { Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { createHouseholdFor, mintBearerSession } from "#/auth/server-helpers.js";
import { member, user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds, iamObjectClaims } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
import type { AppDataHooks } from "#/iam/app-data.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, recordingEmail, signUp, TEST_WEB_ORIGIN, type TestUser } from "#/testing/context.js";
import { iamClient } from "#/testing/rpc.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let owner: TestUser;
let householdId: string;
const email = recordingEmail();

// A stand-in media app whose private data is every object its user uploaded.
const photos: AppDataHooks = {
  app: "photos",
  async privateObjects(c, userId, hId) {
    const rows = await c.db.select().from(iamObjectClaims).where(eq(iamObjectClaims.uploadedBy, userId));
    return rows.filter((r) => r.householdId === hId).map((r) => r.objectId);
  },
  async movePrivateData() {},
  async deletePrivateData() {},
  async sharedItems() {
    return [];
  },
  async copySharedItems() {},
  async deleteHousehold() {},
};

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

/** Signs up through the real HTTP sign-up, which joins people with a member invite. */
async function signUpInvited(address: string): Promise<TestUser> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({ name: address.split("@")[0], email: address, password: "correct horse battery" }),
  });
  expect(res.status, `sign-up for ${address}`).toBe(200);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { id: body.user.id, email: address, headers: new Headers({ authorization: `Bearer ${body.token}` }) };
}

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  ctx = createTestContext(database, { email });
  ctx.apps.push(photos);
  app = createApp(ctx, await loadModules());
  owner = await signUp(ctx, "ada@example.com");
  householdId = (await createHouseholdFor(ctx, owner.id, "Lovelace")).id;
  await database.db.insert(iamHouseholds).values({ householdId, storageCapBytes: 1000n, usedBytes: 40n });
});

afterAll(async () => {
  await database?.drop();
});

describe("member invites and the member limit", () => {
  it("counts pending invites as seats, emails each invite, and joins invitees as they sign up", async () => {
    const asOwner = iamClient(app, owner.headers);
    email.sent.length = 0;
    const invites = [];
    for (const address of ["one@example.com", "two@example.com", "three@example.com"]) {
      invites.push(await asOwner.inviteMember({ email: address, role: Role.MEMBER }));
    }
    expect((await asOwner.listMembers({})).seatsRemaining).toBe(0);
    expect(await codeOf(asOwner.inviteMember({ email: "four@example.com", role: Role.MEMBER }))).toBe(Code.ResourceExhausted);
    expect(email.sent.map((e) => e.to)).toEqual(["one@example.com", "two@example.com", "three@example.com"]);
    expect(email.sent[0]?.url).toBe(invites[0]?.inviteUrl);

    await signUpInvited("one@example.com");
    const members = await asOwner.listMembers({});
    expect(members.members.map((m) => [m.user?.email, m.role])).toEqual([
      ["ada@example.com", Role.OWNER],
      ["one@example.com", Role.MEMBER],
    ]);
    expect(members.pendingInvites).toHaveLength(2);

    await asOwner.cancelMemberInvite({ inviteId: invites[2]!.invite!.id });
    expect((await asOwner.listMembers({})).seatsRemaining).toBe(1);
  });

  it("only invites as Admin or Member, and never an existing member", async () => {
    const asOwner = iamClient(app, owner.headers);
    expect(await codeOf(asOwner.inviteMember({ email: "x@example.com", role: Role.OWNER }))).toBe(Code.InvalidArgument);
    expect(await codeOf(asOwner.inviteMember({ email: "ONE@example.com", role: Role.MEMBER }))).toBe(Code.AlreadyExists);
  });

  it("lets Members see the household but not manage it", async () => {
    const asOne = await asUser("one@example.com");
    expect((await asOne.listMembers({})).members.length).toBe(2);
    expect(await codeOf(asOne.inviteMember({ email: "x@example.com", role: Role.MEMBER }))).toBe(Code.PermissionDenied);
  });
});

describe("the Owner", () => {
  it("cannot be removed or have their role changed except by transfer", async () => {
    const asOwner = iamClient(app, owner.headers);
    expect(await codeOf(asOwner.removeMember({ userId: owner.id }))).toBe(Code.FailedPrecondition);
    expect(await codeOf(asOwner.updateMemberRole({ userId: owner.id, role: Role.MEMBER }))).toBe(Code.FailedPrecondition);
  });

  it("hands ownership to a member, who can hand it back", async () => {
    const one = await userIdOf("one@example.com");
    const asOwner = iamClient(app, owner.headers);
    expect(await codeOf((await asUser("one@example.com")).transferOwnership({ userId: owner.id }))).toBe(Code.PermissionDenied);

    await asOwner.transferOwnership({ userId: one });
    expect(await roles()).toEqual({ [owner.id]: "admin", [one]: "owner" });
    await (await asUser("one@example.com")).transferOwnership({ userId: owner.id });
    expect(await roles()).toEqual({ [owner.id]: "owner", [one]: "admin" });
  });

  it("lets an Admin change Members and Admins", async () => {
    const one = await userIdOf("one@example.com");
    expect((await iamClient(app, owner.headers).updateMemberRole({ userId: one, role: Role.MEMBER })).member?.role).toBe(Role.MEMBER);
  });
});

describe("removing a member", () => {
  it("starts their grace period with their private data held, still billed here", async () => {
    const one = await userIdOf("one@example.com");
    await database.db.insert(iamObjectClaims).values({ objectId: "private-1", householdId, uploadedBy: one, app: "photos", bytes: 25n });
    const asOne = await asUser("one@example.com");

    await iamClient(app, owner.headers).removeMember({ userId: one });
    expect(await database.db.select().from(member).where(eq(member.userId, one))).toEqual([]);
    const [grace] = await database.db.select().from(iamGracePeriods).where(eq(iamGracePeriods.userId, one));
    expect(grace).toMatchObject({ householdId, householdName: "Lovelace", heldBytes: 25n });
    expect(grace!.deleteAt.getTime() - grace!.startedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    const viewer = await asOne.getViewer({});
    expect(viewer.household).toBeUndefined();
    expect(viewer.gracePeriod).toMatchObject({ formerHouseholdName: "Lovelace", privateBytes: 25n });
    expect((await iamClient(app, owner.headers).getViewer({})).usage?.heldBytes).toBe(25n);
  });
});

async function userIdOf(address: string): Promise<string> {
  const [row] = await database.db.select({ id: user.id }).from(user).where(eq(user.email, address));
  return row!.id;
}

async function asUser(address: string) {
  const id = await userIdOf(address);
  const token = await mintBearerSession(ctx, id);
  return iamClient(app, new Headers({ authorization: `Bearer ${token}` }));
}

async function roles(): Promise<Record<string, string>> {
  const rows = await database.db.select().from(member).where(eq(member.organizationId, householdId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}
