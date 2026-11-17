import { Code, ConnectError } from "@connectrpc/connect";
import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { member, session, user } from "#/db/schemas/auth.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#/db/testing.js";
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

/** Signs up an invited person through the real HTTP sign-up, past the invite gate. */
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
  database = await createTestDatabase();
  await pushAllSchemas(database);
  ctx = createTestContext(database, { email });
  app = createApp(ctx, await loadModules());
  owner = await signUp(ctx, "owner@example.com");
  await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, owner.id));
  ada = await signUp(ctx, "ada@example.com");

  const invite = await iamClient(app, owner.headers).createHouseholdInvite({
    allowance: { storageCapBytes: 1000n, enabledApps: [App.PHOTOS] },
  });
  const token = invite.inviteUrl.split("/").at(-1)!;
  const redeemed = await iamClient(app, ada.headers).redeemHouseholdInvite({ token, householdName: "Lovelace" });
  householdId = redeemed.household!.id;
});

afterAll(async () => {
  await database?.drop();
});

describe("redeeming a household creation invite", () => {
  it("created a household with the invite's allowance, with the redeemer as Admin", async () => {
    const viewer = await iamClient(app, ada.headers).getViewer({});
    expect(viewer.activeHouseholdId).toBe(householdId);
    expect(viewer.memberships[0]).toMatchObject({ role: Role.ADMIN, household: { name: "Lovelace", allowance: { memberLimit: 4 } } });
  });

  it("works only once", async () => {
    const invite = await iamClient(app, owner.headers).createHouseholdInvite({ allowance: { storageCapBytes: 1n } });
    const token = invite.inviteUrl.split("/").at(-1)!;
    const bob = await signUp(ctx, "bob@example.com");
    await iamClient(app, bob.headers).redeemHouseholdInvite({ token, householdName: "Bob's" });
    expect(await codeOf(iamClient(app, bob.headers).redeemHouseholdInvite({ token, householdName: "Again" }))).toBe(
      Code.FailedPrecondition,
    );
    expect(await codeOf(iamClient(app, bob.headers).redeemHouseholdInvite({ token: "made-up", householdName: "X" }))).toBe(Code.NotFound);
  });
});

describe("member invites and the member limit", () => {
  it("counts pending invites as seats, emails each invite, and lets the invitee join", async () => {
    const asAda = iamClient(app, ada.headers);
    email.sent.length = 0;
    // Ada holds one of the 4 seats, so three invites fill the household.
    const invites = [];
    for (const address of ["one@example.com", "two@example.com", "three@example.com"]) {
      invites.push(await asAda.inviteMember({ email: address, role: Role.MEMBER }));
    }
    expect((await asAda.listMembers({})).seatsRemaining).toBe(0);
    expect(await codeOf(asAda.inviteMember({ email: "four@example.com", role: Role.MEMBER }))).toBe(Code.ResourceExhausted);
    expect(email.sent.map((e) => e.to)).toEqual(["one@example.com", "two@example.com", "three@example.com"]);
    expect(email.sent[0]?.url).toBe(invites[0]?.inviteUrl);

    const one = await signUpInvited("one@example.com");
    await iamClient(app, one.headers).acceptMemberInvite({ inviteId: invites[0]!.invite!.id });
    const members = await asAda.listMembers({});
    expect(members.members.map((m) => m.user?.email).sort()).toEqual(["ada@example.com", "one@example.com"]);
    expect(members.pendingInvites).toHaveLength(2);
    expect(members.seatsRemaining).toBe(0);

    await asAda.cancelMemberInvite({ inviteId: invites[2]!.invite!.id });
    expect((await asAda.listMembers({})).seatsRemaining).toBe(1);
  });

  it("refuses an invite meant for someone else, and inviting an existing member", async () => {
    const asAda = iamClient(app, ada.headers);
    const res = await asAda.inviteMember({ email: "five@example.com", role: Role.MEMBER });
    const stranger = await signUpInvited("two@example.com");
    expect(await codeOf(iamClient(app, stranger.headers).acceptMemberInvite({ inviteId: res.invite!.id }))).toBe(Code.PermissionDenied);
    expect(await codeOf(asAda.inviteMember({ email: "ONE@example.com", role: Role.MEMBER }))).toBe(Code.AlreadyExists);
  });

  it("lets Members see the household but not manage it", async () => {
    const [oneUser] = await database.db.select().from(user).where(eq(user.email, "one@example.com"));
    const [oneSession] = await database.db.select().from(session).where(eq(session.userId, oneUser!.id));
    const asOne = iamClient(app, new Headers({ authorization: `Bearer ${oneSession!.token}` }));
    expect((await asOne.listMembers({})).members.length).toBeGreaterThan(0);
    expect(await codeOf(asOne.inviteMember({ email: "x@example.com", role: Role.MEMBER }))).toBe(Code.PermissionDenied);
  });
});

describe("the last Admin rule", () => {
  it("refuses to demote or remove the only Admin, and allows it once another exists", async () => {
    const asAda = iamClient(app, ada.headers);
    expect(await codeOf(asAda.updateMemberRole({ userId: ada.id, role: Role.MEMBER }))).toBe(Code.FailedPrecondition);
    expect(await codeOf(asAda.removeMember({ userId: ada.id }))).toBe(Code.FailedPrecondition);

    const [one] = await database.db.select().from(user).where(eq(user.email, "one@example.com"));
    expect((await asAda.updateMemberRole({ userId: one!.id, role: Role.ADMIN })).member?.role).toBe(Role.ADMIN);
    expect(await codeOf(asAda.updateMemberRole({ userId: one!.id, role: Role.MEMBER }))).toBe("ok");
  });

  it("removing a member also clears their active household", async () => {
    const [one] = await database.db.select().from(user).where(eq(user.email, "one@example.com"));
    await iamClient(app, ada.headers).removeMember({ userId: one!.id });
    const rows = await database.db.select().from(member).where(and(eq(member.userId, one!.id), eq(member.organizationId, householdId)));
    expect(rows).toEqual([]);
    const sessions = await database.db.select().from(session).where(eq(session.userId, one!.id));
    expect(sessions.every((s) => s.activeOrganizationId !== householdId)).toBe(true);
  });
});

describe("contributor grants", () => {
  it("issues a grant, emails a sign-in link, and lists and revokes it", async () => {
    const asAda = iamClient(app, ada.headers);
    email.sent.length = 0;
    const { grant } = await asAda.createContributorGrant({
      resource: { app: App.PHOTOS, kind: "album", id: "summer" },
      granteeEmail: "Friend@Example.com",
    });
    expect(grant).toMatchObject({ granteeEmail: "friend@example.com", granteeUserId: "", resource: { app: App.PHOTOS, id: "summer" } });
    expect(email.sent).toEqual([expect.objectContaining({ kind: "magic-link", to: "friend@example.com" })]);
    expect(
      await codeOf(asAda.createContributorGrant({ resource: { app: App.PHOTOS, kind: "album", id: "summer" }, granteeEmail: "friend@example.com" })),
    ).toBe(Code.AlreadyExists);

    const friend = await signUpInvited("friend@example.com");
    const mine = await iamClient(app, friend.headers).listContributorGrants({ mine: true });
    expect(mine.grants.map((g) => g.id)).toEqual([grant!.id]);
    expect((await asAda.listContributorGrants({ resource: { app: App.PHOTOS, kind: "album", id: "summer" } })).grants).toHaveLength(1);

    await asAda.revokeContributorGrant({ grantId: grant!.id });
    expect((await iamClient(app, friend.headers).listContributorGrants({ mine: true })).grants).toEqual([]);
    expect(await codeOf(asAda.revokeContributorGrant({ grantId: grant!.id }))).toBe(Code.NotFound);
  });
});
