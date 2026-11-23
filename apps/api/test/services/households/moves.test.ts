import { randomUUID } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_MEMBER_ROLE, HOUSEHOLD_OWNER_ROLE, type HouseholdRole } from "#/auth/constants.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { getMember } from "#/data/auth/member/get-member.js";
import { createOrganization } from "#/data/auth/organization/create-organization.js";
import { getOrganizationById } from "#/data/auth/organization/get-organization.js";
import { upsertGracePeriod } from "#/data/iam/grace-period/create-grace-period.js";
import { getGracePeriodByUserId } from "#/data/iam/grace-period/get-grace-period.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { getHouseholdById } from "#/data/iam/household/get-household.js";
import { addUsedBytes } from "#/data/iam/household/update-household.js";
import { createObjectClaim } from "#/data/iam/object-claim/create-object-claim.js";
import { getObjectClaim } from "#/data/iam/object-claim/get-object-claim.js";
import { user } from "#/db/schemas/auth.js";
import { EMPTY_HOUSEHOLD_TTL_MS, GRACE_PERIOD_MS } from "#/iam/constants.js";
import type { ModuleContext } from "#/server/modules.js";
import { closeHousehold, deletePrivateData, type MoveTarget, moveMember } from "#/services/households/index.js";
import { createTestContext } from "#test/support/context.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#test/support/db.js";
import { FakeGateway } from "#test/support/fake-gateway.js";
import { installStandInApp, type StandInApp } from "#test/support/stand-in-app.js";

let database: TestDatabase;
let ctx: ModuleContext;
let gateway: FakeGateway;
let app: StandInApp;
let counter = 0;

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await database.db.insert(user).values({ id, name: `User ${++counter}`, email: `user${counter}@example.com` });
  return id;
}

/** A household with these members, the first one its Owner. */
async function makeHousehold(cap: bigint, members: { userId: string; role: HouseholdRole }[]): Promise<string> {
  const org = await createOrganization(database.db, { name: `House ${++counter}`, createdAt: new Date() });
  await createHousehold(database.db, { householdId: org.id, storageCapBytes: cap, enabledApps: ["photos"], memberLimit: 10 });
  for (const m of members) {
    await createMember(database.db, { organizationId: org.id, userId: m.userId, role: m.role, createdAt: new Date() });
  }
  return org.id;
}

/** Stores one item in the stand-in app and bills it to the household. */
async function store(householdId: string, ownerId: string, bytes: bigint, shared = false): Promise<{ itemId: string; objectId: string }> {
  const objectId = gateway.commit("photos", bytes);
  await createObjectClaim(database.db, { objectId, householdId, uploadedBy: ownerId, app: "photos", bytes });
  await addUsedBytes(database.db, householdId, bytes);
  const itemId = await app.add({ householdId, ownerId, shared, name: shared ? "Album" : "Photo", objectId });
  return { itemId, objectId };
}

async function used(householdId: string): Promise<bigint | undefined> {
  return (await getHouseholdById(database.db, householdId))?.usedBytes;
}

async function roleIn(householdId: string, userId: string): Promise<string | null> {
  return (await getMember(database.db, householdId, userId))?.role ?? null;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
  gateway = new FakeGateway();
  app = await installStandInApp(database.db);
  ctx = createTestContext(database, { gateway, apps: [app.hooks] });
});

afterAll(async () => {
  await database?.drop();
});

describe("moveMember", () => {
  it("moves private data and copies chosen items, so both households keep the shared item", async () => {
    const [owner, jo] = [await makeUser(), await makeUser()];
    const from = await makeHousehold(1000n, [
      { userId: owner, role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const mine = await store(from, jo, 30n);
    const album = await store(from, owner, 20n, true);

    const result = await moveMember(ctx, {
      userId: jo,
      target: { kind: "existing", householdId: to, role: HOUSEHOLD_ADMIN_ROLE },
      copyItems: [{ app: "photos", kind: "item", id: album.itemId }],
    });

    expect(result).toEqual({ householdId: to, movedBytes: 30n, copiedBytes: 20n });
    expect(await roleIn(from, jo)).toBeNull();
    expect(await roleIn(to, jo)).toBe(HOUSEHOLD_ADMIN_ROLE);
    expect(await used(from)).toBe(20n);
    expect(await used(to)).toBe(50n);
    expect((await getObjectClaim(database.db, mine.objectId))?.householdId).toBe(to);
    const copied = (await app.items(to)).filter((i) => i.shared);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ ownerId: jo, name: "Album" });
    expect(copied[0]!.objectId).not.toBe(album.objectId);
    expect((await app.items(from)).map((i) => i.id)).toEqual([album.itemId]);
  });

  it("leaves both households exactly as they were when an app fails partway, and deletes the copies", async () => {
    const [owner, jo] = [await makeUser(), await makeUser()];
    const from = await makeHousehold(1000n, [
      { userId: owner, role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const mine = await store(from, jo, 30n);
    const album = await store(from, owner, 20n, true);
    const objectsBefore = gateway.objects.size;

    app.failNextMove();
    await expect(
      moveMember(ctx, {
        userId: jo,
        target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE },
        copyItems: [{ app: "photos", kind: "item", id: album.itemId }],
      }),
    ).rejects.toThrow("stand-in app failed to move");

    expect(await roleIn(from, jo)).toBe(HOUSEHOLD_MEMBER_ROLE);
    expect(await roleIn(to, jo)).toBeNull();
    expect(await used(from)).toBe(50n);
    expect(await used(to)).toBe(0n);
    expect((await getObjectClaim(database.db, mine.objectId))?.householdId).toBe(from);
    expect(await app.items(to)).toEqual([]);
    expect(gateway.objects.size).toBe(objectsBefore);
  });

  it("refuses a move that does not fit, changing nothing", async () => {
    const jo = await makeUser();
    const from = await makeHousehold(1000n, [
      { userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    const to = await makeHousehold(10n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    await store(from, jo, 30n);

    expect(await codeOf(moveMember(ctx, { userId: jo, target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE } }))).toBe(
      Code.ResourceExhausted,
    );
    expect(await roleIn(from, jo)).toBe(HOUSEHOLD_MEMBER_ROLE);
    expect(await used(from)).toBe(30n);
    expect(await used(to)).toBe(0n);
  });

  it("makes an Owner leaving others behind name the next Owner", async () => {
    const [alex, jo] = [await makeUser(), await makeUser()];
    const from = await makeHousehold(1000n, [
      { userId: alex, role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const target: MoveTarget = { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE };

    expect(await codeOf(moveMember(ctx, { userId: alex, target }))).toBe(Code.FailedPrecondition);
    expect(await codeOf(moveMember(ctx, { userId: alex, target, nextOwnerUserId: await makeUser() }))).toBe(Code.FailedPrecondition);
    expect(await roleIn(from, alex)).toBe(HOUSEHOLD_OWNER_ROLE);

    await moveMember(ctx, { userId: alex, target, nextOwnerUserId: jo });
    expect(await roleIn(from, jo)).toBe(HOUSEHOLD_OWNER_ROLE);
    expect((await getHouseholdById(database.db, from))?.closesAt).toBeNull();
  });

  it("keeps the old household until its close date when the last member moves out", async () => {
    const kim = await makeUser();
    const from = await makeHousehold(1000n, [{ userId: kim, role: HOUSEHOLD_OWNER_ROLE }]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    await store(from, kim, 30n);
    await store(from, kim, 5n, true);
    const now = new Date();

    await moveMember(ctx, { userId: kim, target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE }, now });

    const old = await getHouseholdById(database.db, from);
    expect(old?.closesAt?.getTime()).toBe(now.getTime() + EMPTY_HOUSEHOLD_TTL_MS);
    expect(old?.usedBytes).toBe(5n);
    expect(await getGracePeriodByUserId(database.db, kim)).toBeNull();
  });

  it("creates the household for a creation invite, and leaves nothing behind when the move fails", async () => {
    const jo = await makeUser();
    const from = await makeHousehold(1000n, [
      { userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    await store(from, jo, 30n);
    const create = (cap: bigint) => ({
      kind: "new" as const,
      name: "Jo's place",
      allowance: { storageCapBytes: cap, enabledApps: ["photos" as const], memberLimit: 4 },
    });
    let failedId = "";
    expect(
      await codeOf(
        moveMember(ctx, {
          userId: jo,
          target: create(10n),
          onJoined: async (_tx, householdId) => {
            failedId = householdId;
          },
        }),
      ),
    ).toBe(Code.ResourceExhausted);
    expect(failedId).toBe("");
    expect(await roleIn(from, jo)).toBe(HOUSEHOLD_MEMBER_ROLE);

    let joinedId = "";
    const result = await moveMember(ctx, {
      userId: jo,
      target: create(1000n),
      onJoined: async (_tx, householdId) => {
        joinedId = householdId;
      },
    });
    expect(joinedId).toBe(result.householdId);
    expect((await getOrganizationById(database.db, result.householdId))?.name).toBe("Jo's place");
    expect(await roleIn(result.householdId, jo)).toBe(HOUSEHOLD_OWNER_ROLE);
    expect(await used(result.householdId)).toBe(30n);
  });

  it("brings held data along when joining during a grace period, and ends it", async () => {
    const jo = await makeUser();
    const from = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    await store(from, jo, 30n);
    const now = new Date();
    await upsertGracePeriod(database.db, {
      userId: jo,
      householdId: from,
      householdName: "Old",
      heldBytes: 30n,
      startedAt: now,
      deleteAt: new Date(now.getTime() + GRACE_PERIOD_MS),
    });

    expect(
      await codeOf(
        moveMember(ctx, {
          userId: jo,
          target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE },
          copyItems: [{ app: "photos", kind: "item", id: "x" }],
        }),
      ),
    ).toBe(Code.FailedPrecondition);

    const result = await moveMember(ctx, { userId: jo, target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE } });
    expect(result.movedBytes).toBe(30n);
    expect(await used(from)).toBe(0n);
    expect(await getGracePeriodByUserId(database.db, jo)).toBeNull();
  });

  it("refuses a chosen item that is gone, without making copies", async () => {
    const jo = await makeUser();
    const from = await makeHousehold(1000n, [
      { userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE },
      { userId: jo, role: HOUSEHOLD_MEMBER_ROLE },
    ]);
    const to = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const before = gateway.objects.size;
    expect(
      await codeOf(
        moveMember(ctx, {
          userId: jo,
          target: { kind: "existing", householdId: to, role: HOUSEHOLD_MEMBER_ROLE },
          copyItems: [{ app: "photos", kind: "item", id: randomUUID() }],
        }),
      ),
    ).toBe(Code.NotFound);
    expect(gateway.objects.size).toBe(before);
    expect(await roleIn(from, jo)).toBe(HOUSEHOLD_MEMBER_ROLE);
  });
});

describe("deletePrivateData", () => {
  it("deletes and refunds a person's private data once, and ends their grace period", async () => {
    const jo = await makeUser();
    const household = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    const mine = await store(household, jo, 30n);
    await store(household, jo, 5n, true);
    const now = new Date();
    await upsertGracePeriod(database.db, { userId: jo, householdId: household, householdName: "H", heldBytes: 30n, startedAt: now, deleteAt: now });

    await deletePrivateData(ctx, jo, household);
    await deletePrivateData(ctx, jo, household);

    expect(await used(household)).toBe(5n);
    expect(gateway.objects.has(mine.objectId)).toBe(false);
    expect((await app.items(household)).map((i) => i.shared)).toEqual([true]);
    expect(await getGracePeriodByUserId(database.db, jo)).toBeNull();
  });
});

describe("closeHousehold", () => {
  it("releases every object once and deletes the household, even when run twice", async () => {
    const kim = await makeUser();
    const household = await makeHousehold(1000n, []);
    const a = await store(household, kim, 30n);
    const b = await store(household, kim, 5n, true);

    await closeHousehold(ctx, household);
    await closeHousehold(ctx, household);

    expect(await getOrganizationById(database.db, household)).toBeNull();
    expect(gateway.objects.has(a.objectId)).toBe(false);
    expect(gateway.objects.has(b.objectId)).toBe(false);
    expect(gateway.deleted.filter((id) => id === a.objectId)).toHaveLength(1);
    expect(await app.items(household)).toEqual([]);
  });

  it("refuses to close a household that still has members", async () => {
    const household = await makeHousehold(1000n, [{ userId: await makeUser(), role: HOUSEHOLD_OWNER_ROLE }]);
    expect(await codeOf(closeHousehold(ctx, household))).toBe(Code.FailedPrecondition);
    expect(await getOrganizationById(database.db, household)).not.toBeNull();
  });
});
