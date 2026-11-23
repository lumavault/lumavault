import { randomUUID } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_MEMBER_ROLE, HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { createOrganization } from "#/data/auth/organization/create-organization.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { invitation } from "#/db/schemas/auth.js";
import { iamHouseholdInvites, iamHouseholds } from "#/db/schemas/iam.js";
import { DEFAULT_MEMBER_LIMIT } from "#/iam/constants.js";
import { MAX_PAGE_SIZE } from "#/lib/constants.js";
import { HOUSEHOLD_INVITE_PATH } from "#/routes.js";
import { hashSecret } from "#/lib/secrets.js";
import { createApp } from "#/server/app.js";
import { loadModules, type ModuleContext } from "#/server/modules.js";
import { createTestContext, recordingEmail, signUp, TEST_WEB_ORIGIN, type TestUser } from "#test/support/context.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#test/support/db.js";
import { iamClient } from "#test/support/rpc.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let email: ReturnType<typeof recordingEmail>;
let adminHeaders: Headers;
let adminId: string;
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

const allowance = { storageCapBytes: 10n * 2n ** 30n, enabledApps: [App.PHOTOS, App.CINEMA], memberLimit: 6 };

/** A household owned by a new user, created straight in the database. */
async function makeHousehold(name: string, ownerEmail: string): Promise<{ id: string; owner: TestUser }> {
  const user = await signUp(ctx, ownerEmail);
  const org = await createOrganization(ctx.db, { name, createdAt: new Date() });
  await createMember(ctx.db, { organizationId: org.id, userId: user.id, role: HOUSEHOLD_OWNER_ROLE, createdAt: new Date() });
  await createHousehold(ctx.db, { householdId: org.id, storageCapBytes: allowance.storageCapBytes, enabledApps: ["photos"], memberLimit: 4 });
  return { id: org.id, owner: user };
}

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
  email = recordingEmail();
  ctx = createTestContext(database, { email });
  app = createApp(ctx, await loadModules());

  let setCookie: string[] = [];
  await iamClient(app).completeSetup(
    { name: "Root", email: "root@example.com", password: "correct horse battery", householdName: "Home" },
    { onHeader: (h) => (setCookie = h.getSetCookie()) },
  );
  adminHeaders = new Headers({ cookie: setCookie.map((c) => c.split(";")[0]).join("; ") });
  adminId = (await iamClient(app, adminHeaders).getViewer({})).user!.id;

  const made = await makeHousehold("Smiths", "smith@example.com");
  householdId = made.id;
  owner = made.owner;
});

afterAll(async () => {
  await database.drop();
});

describe("Super-Admin access", () => {
  const calls: [string, (c: ReturnType<typeof iamClient>) => Promise<unknown>][] = [
    ["CreateHouseholdInvite", (c) => c.createHouseholdInvite({ email: "x@example.com", allowance })],
    ["ListHouseholdInvites", (c) => c.listHouseholdInvites({})],
    ["RevokeHouseholdInvite", (c) => c.revokeHouseholdInvite({ inviteId: randomUUID() })],
    ["ListHouseholds", (c) => c.listHouseholds({})],
    ["UpdateHouseholdAllowance", (c) => c.updateHouseholdAllowance({ householdId: "h", allowance })],
    ["ListUsers", (c) => c.listUsers({})],
  ];

  it.each(calls)("%s needs a session", async (_name, call) => {
    expect(await codeOf(call(iamClient(app)))).toBe(Code.Unauthenticated);
  });

  it.each(calls)("%s refuses a household Owner who is not Super-Admin", async (_name, call) => {
    expect(await codeOf(call(iamClient(app, owner.headers)))).toBe(Code.PermissionDenied);
  });
});

describe("household creation invites", () => {
  it("stores only the hash of the emailed link and returns the link once", async () => {
    const res = await iamClient(app, adminHeaders).createHouseholdInvite({ email: " New@Example.com ", allowance, note: " cousin " });
    expect(res.inviteUrl.startsWith(`${TEST_WEB_ORIGIN}${HOUSEHOLD_INVITE_PATH}`)).toBe(true);
    expect(res.invite).toMatchObject({ email: "new@example.com", note: "cousin", allowance });

    const token = res.inviteUrl.slice(`${TEST_WEB_ORIGIN}${HOUSEHOLD_INVITE_PATH}`.length);
    const [row] = await ctx.db.select().from(iamHouseholdInvites).where(eq(iamHouseholdInvites.id, res.invite!.id));
    expect(row!.tokenHash).toBe(hashSecret(token));
    expect(row!.createdBy).toBe(adminId);
    expect(email.sent.at(-1)).toEqual({ kind: "household-invite", to: "new@example.com", url: res.inviteUrl });

    const expiresIn = Number(res.invite!.expiresAt!.seconds) * 1000 - Date.now();
    expect(expiresIn).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
  });

  it("replaces an open invite for the same email", async () => {
    const client = iamClient(app, adminHeaders);
    const first = await client.createHouseholdInvite({ email: "twice@example.com", allowance });
    const second = await client.createHouseholdInvite({ email: "twice@example.com", allowance });
    const open = (await client.listHouseholdInvites({})).invites.filter((i) => i.email === "twice@example.com");
    expect(open.map((i) => i.id)).toEqual([second.invite!.id]);
    expect(first.invite!.id).not.toBe(second.invite!.id);
  });

  it("uses the default member limit when none is given", async () => {
    const res = await iamClient(app, adminHeaders).createHouseholdInvite({
      email: "default@example.com",
      allowance: { ...allowance, memberLimit: 0 },
    });
    expect(res.invite!.allowance!.memberLimit).toBe(DEFAULT_MEMBER_LIMIT);
  });

  it("rejects a bad email or allowance", async () => {
    const client = iamClient(app, adminHeaders);
    const bad = [
      { email: "not-an-email", allowance },
      { email: "a@example.com" },
      { email: "a@example.com", allowance: { ...allowance, storageCapBytes: 0n } },
      { email: "a@example.com", allowance: { ...allowance, storageCapBytes: 2n ** 63n } },
      { email: "a@example.com", allowance: { ...allowance, enabledApps: [] } },
      { email: "a@example.com", allowance: { ...allowance, enabledApps: [App.UNSPECIFIED] } },
    ];
    for (const req of bad) {
      expect(await codeOf(client.createHouseholdInvite(req))).toBe(Code.InvalidArgument);
    }
  });

  it("revokes an invite once and refuses a used or unknown one", async () => {
    const client = iamClient(app, adminHeaders);
    const { invite } = await client.createHouseholdInvite({ email: "revoke@example.com", allowance });
    await client.revokeHouseholdInvite({ inviteId: invite!.id });
    await client.revokeHouseholdInvite({ inviteId: invite!.id });
    expect((await client.listHouseholdInvites({})).invites.map((i) => i.id)).not.toContain(invite!.id);

    const used = await client.createHouseholdInvite({ email: "used@example.com", allowance });
    await ctx.db.update(iamHouseholdInvites).set({ redeemedAt: new Date() }).where(eq(iamHouseholdInvites.id, used.invite!.id));
    expect(await codeOf(client.revokeHouseholdInvite({ inviteId: used.invite!.id }))).toBe(Code.FailedPrecondition);
    expect((await client.listHouseholdInvites({})).invites.map((i) => i.id)).not.toContain(used.invite!.id);

    expect(await codeOf(client.revokeHouseholdInvite({ inviteId: randomUUID() }))).toBe(Code.NotFound);
    expect(await codeOf(client.revokeHouseholdInvite({ inviteId: "nope" }))).toBe(Code.InvalidArgument);
  });
});

describe("households", () => {
  it("lists every household with its owner, usage, and counts", async () => {
    await ctx.db.insert(invitation).values({
      id: randomUUID(),
      organizationId: householdId,
      email: "pending@example.com",
      role: HOUSEHOLD_MEMBER_ROLE,
      status: "pending",
      expiresAt: new Date(Date.now() + 3600_000),
      inviterId: owner.id,
    });
    const { households } = await iamClient(app, adminHeaders).listHouseholds({});
    const smiths = households.find((h) => h.household?.id === householdId);
    expect(smiths).toMatchObject({
      household: { name: "Smiths", ownerUserId: owner.id },
      owner: { id: owner.id, email: owner.email },
      usage: { usedBytes: 0n, reservedBytes: 0n, remainingBytes: allowance.storageCapBytes },
      memberCount: 1,
      pendingInviteCount: 1,
    });
    expect(households.map((h) => h.household?.name)).toContain("Home");
  });

  it("pages through households without repeats", async () => {
    for (let i = 0; i < 3; i++) {
      await makeHousehold(`Paged ${i}`, `paged${i}@example.com`);
    }
    const client = iamClient(app, adminHeaders);
    const seen: string[] = [];
    let pageToken = "";
    do {
      const page = await client.listHouseholds({ pageSize: 2, pageToken });
      expect(page.households.length).toBeLessThanOrEqual(2);
      seen.push(...page.households.map((h) => h.household!.id));
      pageToken = page.nextPageToken;
    } while (pageToken);
    const all = (await client.listHouseholds({ pageSize: MAX_PAGE_SIZE + 1 })).households.map((h) => h.household!.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(5);

    expect(await codeOf(client.listHouseholds({ pageToken: "garbage" }))).toBe(Code.InvalidArgument);
    expect(await codeOf(client.listHouseholds({ pageSize: -1 }))).toBe(Code.InvalidArgument);
  });

  it("changes only the masked allowance fields, even below current usage", async () => {
    const client = iamClient(app, adminHeaders);
    await ctx.db.update(iamHouseholds).set({ usedBytes: 5000n }).where(eq(iamHouseholds.householdId, householdId));

    const capOnly = await client.updateHouseholdAllowance({
      householdId,
      allowance: { storageCapBytes: 1000n },
      updateMask: { paths: ["storage_cap_bytes"] },
    });
    expect(capOnly.household!.allowance).toMatchObject({ storageCapBytes: 1000n, enabledApps: [App.PHOTOS], memberLimit: 4 });

    const all = await client.updateHouseholdAllowance({
      householdId,
      allowance: { storageCapBytes: 2000n, enabledApps: [App.ARCADE], memberLimit: 1 },
    });
    expect(all.household!.allowance).toMatchObject({ storageCapBytes: 2000n, enabledApps: [App.ARCADE], memberLimit: 1 });
    expect(all.household!.ownerUserId).toBe(owner.id);

    const smiths = (await client.listHouseholds({ pageSize: MAX_PAGE_SIZE })).households.find((h) => h.household?.id === householdId);
    expect(smiths!.usage!.remainingBytes).toBe(0n);
  });

  it("rejects a bad allowance update", async () => {
    const client = iamClient(app, adminHeaders);
    const bad = [
      { householdId, allowance, updateMask: { paths: ["name"] } },
      { householdId, allowance: { ...allowance, memberLimit: 0 }, updateMask: { paths: ["member_limit"] } },
      { householdId, allowance: { ...allowance, enabledApps: [] }, updateMask: { paths: ["enabled_apps"] } },
      { householdId, updateMask: { paths: ["member_limit"] } },
      { householdId: "", allowance },
    ];
    for (const req of bad) {
      expect(await codeOf(client.updateHouseholdAllowance(req))).toBe(Code.InvalidArgument);
    }
    expect(await codeOf(client.updateHouseholdAllowance({ householdId: "missing", allowance }))).toBe(Code.NotFound);
  });

});

describe("users", () => {
  it("finds users by name or email, ignoring case, with wildcards taken literally", async () => {
    await signUp(ctx, "ada_lovelace@example.com");
    await signUp(ctx, "adaxlovelace@example.com");
    const client = iamClient(app, adminHeaders);
    expect((await client.listUsers({ query: "ADA_" })).users.map((u) => u.email)).toEqual(["ada_lovelace@example.com"]);
    expect((await client.listUsers({ query: "lovelace" })).users).toHaveLength(2);
    expect((await client.listUsers({ query: "%" })).users).toHaveLength(0);
    const root = (await client.listUsers({ query: "root" })).users[0];
    expect(root).toMatchObject({ id: adminId, isSuperAdmin: true });
  });

  it("pages through users without repeats", async () => {
    const client = iamClient(app, adminHeaders);
    const seen: string[] = [];
    let pageToken = "";
    do {
      const page = await client.listUsers({ pageSize: 3, pageToken });
      seen.push(...page.users.map((u) => u.id));
      pageToken = page.nextPageToken;
    } while (pageToken);
    const all = (await client.listUsers({ pageSize: MAX_PAGE_SIZE })).users.map((u) => u.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
