import { Code, ConnectError } from "@connectrpc/connect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { requestContext } from "#/server/context.js";
import { member, user } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import type { IamApp } from "#/iam/constants.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#test/support/db.js";
import {
  type GuardInput,
  requireApp,
  requireHouseholdAdmin,
  requireHouseholdMember,
  requireHouseholdOwner,
  requireSignedIn,
  requireSuperAdmin,
} from "#/guards.js";
import type { ModuleContext } from "#/server/modules.js";
import { createTestContext, rpcValues, signUp, type TestUser } from "#test/support/context.js";

let database: TestDatabase;
let ctx: ModuleContext;
let owner: TestUser;
let admin: TestUser;
let memberUser: TestUser;
let outsider: TestUser;
let superAdmin: TestUser;
let householdId: string;

const as = (u?: TestUser): GuardInput => ({ values: rpcValues(u?.headers) });

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function setEnabledApps(id: string, enabledApps: IamApp[]): Promise<void> {
  await database.db.update(iamHouseholds).set({ enabledApps }).where(eq(iamHouseholds.householdId, id));
}

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
  ctx = createTestContext(database);

  owner = await signUp(ctx, "owner@example.com");
  admin = await signUp(ctx, "admin@example.com");
  memberUser = await signUp(ctx, "member@example.com");
  outsider = await signUp(ctx, "outsider@example.com");
  superAdmin = await signUp(ctx, "root@example.com");
  await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, superAdmin.id));

  const household = await ctx.auth.api.createOrganization({ body: { name: "Home", slug: "home" }, headers: owner.headers });
  householdId = household!.id;
  await database.db.insert(iamHouseholds).values({ householdId });
  await ctx.auth.api.addMember({ body: { userId: admin.id, organizationId: householdId, role: "admin" } });
  await ctx.auth.api.addMember({ body: { userId: memberUser.id, organizationId: householdId, role: "member" } });
  await ctx.auth.api.addMember({ body: { userId: superAdmin.id, organizationId: householdId, role: "member" } });
});

afterAll(async () => {
  await database?.drop();
});

describe("requestContext", () => {
  it("is empty when signed out", async () => {
    expect(await requestContext(as().values, ctx)).toEqual({ viewer: null, household: null });
  });

  it("reads the viewer and their one household from membership, not the session", async () => {
    const { viewer, household } = await requestContext(as(owner).values, ctx);
    expect(viewer).toMatchObject({ userId: owner.id, isSuperAdmin: false });
    expect(household).toEqual({ householdId, role: "owner", enabledApps: [] });
    // Members never chose an active household on their session; they still resolve.
    expect((await requestContext(as(memberUser).values, ctx)).household?.role).toBe("member");
  });

  it("has no household for someone who belongs to none", async () => {
    expect((await requestContext(as(outsider).values, ctx)).household).toBeNull();
  });

  it("resolves once per request", async () => {
    const input = as(owner);
    expect(requestContext(input.values, ctx)).toBe(requestContext(input.values, ctx));
  });
});

describe("guards", () => {
  it("requireSignedIn rejects signed-out callers with unauthenticated", async () => {
    expect(await codeOf(requireSignedIn(as(), ctx))).toBe(Code.Unauthenticated);
    expect(await codeOf(requireSignedIn(as(outsider), ctx))).toBe("ok");
  });

  it("requireSuperAdmin allows only the Super-Admin", async () => {
    expect(await codeOf(requireSuperAdmin(as(), ctx))).toBe(Code.Unauthenticated);
    expect(await codeOf(requireSuperAdmin(as(owner), ctx))).toBe(Code.PermissionDenied);
    expect(await codeOf(requireSuperAdmin(as(superAdmin), ctx))).toBe("ok");
  });

  it("requireHouseholdMember needs a household", async () => {
    expect(await codeOf(requireHouseholdMember(as(outsider), ctx))).toBe(Code.FailedPrecondition);
    for (const u of [owner, admin, memberUser]) {
      expect(await codeOf(requireHouseholdMember(as(u), ctx))).toBe("ok");
    }
  });

  it("requireHouseholdAdmin allows the Owner and Admins", async () => {
    expect(await codeOf(requireHouseholdAdmin(as(memberUser), ctx))).toBe(Code.PermissionDenied);
    expect(await codeOf(requireHouseholdAdmin(as(admin), ctx))).toBe("ok");
    expect(await codeOf(requireHouseholdAdmin(as(owner), ctx))).toBe("ok");
  });

  it("requireHouseholdOwner allows only the Owner", async () => {
    expect(await codeOf(requireHouseholdOwner(as(admin), ctx))).toBe(Code.PermissionDenied);
    expect(await codeOf(requireHouseholdOwner(as(owner), ctx))).toBe("ok");
  });

  it("a removed member loses the household at once", async () => {
    const leaver = await signUp(ctx, "leaver@example.com");
    await ctx.auth.api.addMember({ body: { userId: leaver.id, organizationId: householdId, role: "member" } });
    expect(await codeOf(requireHouseholdMember(as(leaver), ctx))).toBe("ok");
    await database.db.delete(member).where(eq(member.userId, leaver.id));
    expect(await codeOf(requireHouseholdMember(as(leaver), ctx))).toBe(Code.FailedPrecondition);
  });
});

describe("requireApp", () => {
  const superAdminOnly = { allowSuperAdminWithoutHousehold: true } as const;
  let loneSuperAdmin: TestUser;

  beforeAll(async () => {
    loneSuperAdmin = await signUp(ctx, "lone-root@example.com");
    await database.db.update(user).set({ role: SUPER_ADMIN_ROLE }).where(eq(user.id, loneSuperAdmin.id));
  });

  it("refuses a member of a household without the app", async () => {
    await setEnabledApps(householdId, ["photos"]);
    try {
      expect(await codeOf(requireApp(as(memberUser), ctx, "cinema"))).toBe(Code.PermissionDenied);
      expect(await codeOf(requireApp(as(memberUser), ctx, "cinema", superAdminOnly))).toBe(Code.PermissionDenied);
      expect(await codeOf(requireApp(as(memberUser), ctx, "photos"))).toBe("ok");
    } finally {
      await setEnabledApps(householdId, []);
    }
  });

  it("lets a member in with their household when the app is on", async () => {
    await setEnabledApps(householdId, ["cinema"]);
    try {
      const caller = await requireApp(as(memberUser), ctx, "cinema", superAdminOnly);
      expect(caller.household?.householdId).toBe(householdId);
    } finally {
      await setEnabledApps(householdId, []);
    }
  });

  it("needs sign-in and a household like requireHouseholdMember", async () => {
    expect(await codeOf(requireApp(as(), ctx, "cinema", superAdminOnly))).toBe(Code.Unauthenticated);
    expect(await codeOf(requireApp(as(outsider), ctx, "cinema", superAdminOnly))).toBe(Code.FailedPrecondition);
    expect(await codeOf(requireApp(as(loneSuperAdmin), ctx, "cinema"))).toBe(Code.FailedPrecondition);
  });

  it("lets a Super-Admin with no household in when allowed", async () => {
    const caller = await requireApp(as(loneSuperAdmin), ctx, "cinema", superAdminOnly);
    expect(caller).toMatchObject({ viewer: { userId: loneSuperAdmin.id }, household: null });
  });

  it("lets a Super-Admin in without the app when allowed", async () => {
    expect(await codeOf(requireApp(as(superAdmin), ctx, "cinema"))).toBe(Code.PermissionDenied);
    expect((await requireApp(as(superAdmin), ctx, "cinema", superAdminOnly)).household).toBeNull();
  });

  it("gives a Super-Admin their household when it has the app on", async () => {
    await setEnabledApps(householdId, ["cinema"]);
    try {
      expect((await requireApp(as(superAdmin), ctx, "cinema", superAdminOnly)).household?.householdId).toBe(householdId);
    } finally {
      await setEnabledApps(householdId, []);
    }
  });
});
