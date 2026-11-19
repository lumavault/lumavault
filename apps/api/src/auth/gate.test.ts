import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { requestContext } from "#/context.js";
import { invitation, member, user } from "#/db/schemas/auth.js";
import { iamHouseholdInvites } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
import { hashSecret, newSecret } from "#/iam/secrets.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, rpcValues, signUp, TEST_WEB_ORIGIN, type TestUser } from "#/testing/context.js";
import { SUPER_ADMIN_ROLE } from "./constants.js";
import { isLockedAuthPath } from "./org-lockdown.js";
import { createFirstAdmin, createHouseholdFor, mintBearerSession } from "./server-helpers.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let owner: TestUser;

function signUpRequest(address: string) {
  return app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({ name: "New", email: address, password: "correct horse battery" }),
  });
}

async function householdInvite(email: string, overrides: Partial<typeof iamHouseholdInvites.$inferInsert> = {}) {
  await database.db.insert(iamHouseholdInvites).values({
    tokenHash: hashSecret(newSecret()),
    email,
    storageCapBytes: 10n ** 9n,
    createdBy: owner.id,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  });
}

async function userId(address: string): Promise<string | undefined> {
  const [row] = await database.db.select({ id: user.id }).from(user).where(eq(user.email, address));
  return row?.id;
}

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  ctx = createTestContext(database);
  app = createApp(ctx, await loadModules());
  owner = await signUp(ctx, "owner@example.com");
});

afterAll(async () => {
  await database?.drop();
});

describe("sign-up gate", () => {
  it("rejects a stranger", async () => {
    expect((await signUpRequest("stranger@example.com")).status).toBe(403);
    expect(await userId("stranger@example.com")).toBeUndefined();
  });

  it("accepts the email a household creation invite was sent to, and no other", async () => {
    await householdInvite("invited@example.com");
    expect((await signUpRequest("someone-else@example.com")).status).toBe(403);
    expect((await signUpRequest("Invited@Example.com")).status).toBe(200);
  });

  it("rejects an expired, revoked, or redeemed household invite", async () => {
    const past = new Date(Date.now() - 1000);
    await householdInvite("expired@example.com", { expiresAt: past });
    await householdInvite("revoked@example.com", { revokedAt: past });
    await householdInvite("redeemed@example.com", { redeemedAt: past });
    for (const address of ["expired@example.com", "revoked@example.com", "redeemed@example.com"]) {
      expect((await signUpRequest(address)).status, address).toBe(403);
    }
  });

  it("joins someone with a member invite to that household as they sign up", async () => {
    const household = await createHouseholdFor(ctx, owner.id, "Home");
    await ctx.auth.api.createInvitation({
      body: { email: "joiner@example.com", role: "admin", organizationId: household.id },
      headers: owner.headers,
    });
    expect((await signUpRequest("joiner@example.com")).status).toBe(200);

    const id = await userId("joiner@example.com");
    const rows = await database.db.select().from(member).where(eq(member.userId, id!));
    expect(rows).toEqual([expect.objectContaining({ organizationId: household.id, role: "admin" })]);
    const [invite] = await database.db.select().from(invitation).where(eq(invitation.email, "joiner@example.com"));
    expect(invite?.status).toBe("accepted");
  });

  it("does not let a magic link create an account for an uninvited email", async () => {
    await app.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN },
      body: JSON.stringify({ email: "nobody@example.com", callbackURL: `${TEST_WEB_ORIGIN}/` }),
    });
    expect(await userId("nobody@example.com")).toBeUndefined();
  });
});

describe("household endpoint lockdown", () => {
  it("rejects every client request to organization and admin endpoints", async () => {
    const paths = [
      ["POST", "/api/auth/organization/create"],
      ["POST", "/api/auth/organization/invite-member"],
      ["POST", "/api/auth/organization/update-member-role"],
      ["GET", "/api/auth/organization/list"],
      ["POST", "/api/auth/admin/ban-user"],
      ["GET", "/api/auth/admin/list-users"],
    ] as const;
    for (const [method, path] of paths) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN, ...Object.fromEntries(owner.headers) },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, path).toBe(403);
    }
  });

  it("leaves sign-in and session routes open", () => {
    expect(isLockedAuthPath("/api/auth/sign-in/email")).toBe(false);
    expect(isLockedAuthPath("/api/auth/get-session")).toBe(false);
    expect(isLockedAuthPath("/api/auth/organization/create")).toBe(true);
  });

  it("still lets the server do the same actions", async () => {
    const someone = await signUp(ctx, "server-made@example.com");
    const household = await createHouseholdFor(ctx, someone.id, "Server-made");
    const members = await database.db.select().from(member).where(eq(member.organizationId, household.id));
    expect(members).toEqual([expect.objectContaining({ userId: someone.id, role: "owner" })]);
  });
});

describe("server helpers", () => {
  it("createFirstAdmin passes the gate and sets the Super-Admin flag", async () => {
    const admin = await createFirstAdmin(ctx, { name: "Root", email: "root@example.com", password: "correct horse battery" });
    expect(admin.setCookie.join(";")).toMatch(/session_token=/);
    const { viewer } = await requestContext(rpcValues(new Headers({ authorization: `Bearer ${admin.token}` })), ctx);
    expect(viewer).toMatchObject({ userId: admin.userId, isSuperAdmin: true });
    const [row] = await database.db.select().from(user).where(eq(user.id, admin.userId));
    expect(row?.role).toBe(SUPER_ADMIN_ROLE);
  });

  it("mintBearerSession opens a session for that user in their household", async () => {
    const tv = await signUp(ctx, "tv-owner@example.com");
    const household = await createHouseholdFor(ctx, tv.id, "Living Room");
    const token = await mintBearerSession(ctx, tv.id);
    const { household: theirs } = await requestContext(rpcValues(new Headers({ authorization: `Bearer ${token}` })), ctx);
    expect(theirs).toMatchObject({ householdId: household.id, role: "owner" });
  });
});
