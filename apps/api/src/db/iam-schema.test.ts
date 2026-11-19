import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_LIMIT } from "#/iam/constants.js";
import { organization, user } from "./schemas/auth.js";
import { iamGracePeriods, iamHouseholdInvites, iamHouseholds, iamInstanceSettings, iamObjectClaims, iamPairingRequests } from "./schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.js";

let database: TestDatabase;
let userId: string;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const inAnHour = () => new Date(Date.now() + 3_600_000);

async function newHousehold(): Promise<string> {
  const id = randomUUID();
  await database.db.insert(organization).values({ id, name: "Home", slug: id, createdAt: new Date() });
  return id;
}

// Postgres reports constraint failures as error code 23xxx with the constraint name.
async function expectConstraint(promise: Promise<unknown>, constraint: string): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected ${constraint} to reject the write`).toBeDefined();
  const cause = (err as { cause?: { constraint?: string } }).cause;
  expect(cause?.constraint).toBe(constraint);
}

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  userId = randomUUID();
  await database.db.insert(user).values({ id: userId, name: "Ada", email: "ada@example.com" });
});

afterAll(async () => {
  await database?.drop();
});

describe("households", () => {
  it("gets a member limit of 4 and empty usage by default", async () => {
    const householdId = await newHousehold();
    const [row] = await database.db.insert(iamHouseholds).values({ householdId }).returning();
    expect(row).toMatchObject({ memberLimit: DEFAULT_MEMBER_LIMIT, usedBytes: 0n, reservedBytes: 0n, suspended: false });
  });

  it("holds byte counts above 2^53 exactly", async () => {
    const householdId = await newHousehold();
    const big = 10n * 2n ** 50n + 7n;
    const [row] = await database.db.insert(iamHouseholds).values({ householdId, usedBytes: big }).returning();
    expect(row?.usedBytes).toBe(big);
  });

  it("accepts only known apps", async () => {
    const householdId = await newHousehold();
    await expectConstraint(
      database.db.insert(iamHouseholds).values({ householdId, enabledApps: ["photos", "tiktok" as "photos"] }),
      "households_enabled_apps_known",
    );
  });

  it("rejects negative byte counts", async () => {
    for (const [field, constraint] of [
      ["usedBytes", "households_used_bytes_nonnegative"],
      ["reservedBytes", "households_reserved_bytes_nonnegative"],
      ["storageCapBytes", "households_storage_cap_bytes_nonnegative"],
    ] as const) {
      const householdId = await newHousehold();
      await expectConstraint(database.db.insert(iamHouseholds).values({ householdId, [field]: -1n }), constraint);
    }
  });
});

describe("object claims", () => {
  it("lets each object be claimed once", async () => {
    const householdId = await newHousehold();
    await database.db.insert(iamObjectClaims).values({ objectId: "obj-1", householdId, app: "photos", bytes: 10n });
    await expectConstraint(
      database.db.insert(iamObjectClaims).values({ objectId: "obj-1", householdId, app: "photos", bytes: 10n }),
      "object_claims_pkey",
    );
  });
});

describe("secrets", () => {
  it("stores invite tokens only as SHA-256", async () => {
    const base = { email: "new@example.com", storageCapBytes: 0n, createdBy: userId, expiresAt: inAnHour() };
    await database.db.insert(iamHouseholdInvites).values({ ...base, tokenHash: sha256("secret") });
    await expectConstraint(
      database.db.insert(iamHouseholdInvites).values({ ...base, tokenHash: "plain-secret-token" }),
      "household_invites_token_hash_is_sha256",
    );
  });

  it("stores device secrets only as SHA-256", async () => {
    const base = { code: "ABC234", deviceName: "Living Room", requesterIp: "127.0.0.1", expiresAt: inAnHour() };
    await database.db.insert(iamPairingRequests).values({ ...base, deviceSecretHash: sha256("device") });
    await expectConstraint(
      database.db.insert(iamPairingRequests).values({ ...base, code: "XYZ789", deviceSecretHash: "device" }),
      "pairing_requests_device_secret_hash_is_sha256",
    );
  });

  it("has no column that could hold a plain secret", async () => {
    const res = await database.db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'iam' and (column_name like '%token%' or column_name like '%secret%')`);
    for (const { column_name } of res.rows) {
      expect(column_name).toMatch(/_hash$/);
    }
  });

  it("keeps pending pairing codes unique", async () => {
    const base = { deviceName: "Den", requesterIp: "127.0.0.1", expiresAt: inAnHour() };
    await database.db.insert(iamPairingRequests).values({ ...base, code: "DUP234", deviceSecretHash: sha256("a") });
    await expectConstraint(
      database.db.insert(iamPairingRequests).values({ ...base, code: "DUP234", deviceSecretHash: sha256("b") }),
      "pairing_requests_pending_code_unique",
    );
  });
});

describe("grace periods", () => {
  it("allow one per user and never negative held bytes", async () => {
    const householdId = await newHousehold();
    const row = { userId, householdId, householdName: "Home", heldBytes: 10n, deleteAt: inAnHour() };
    await database.db.insert(iamGracePeriods).values(row);
    await expectConstraint(database.db.insert(iamGracePeriods).values(row), "grace_periods_pkey");
    await database.db.delete(iamGracePeriods);
    await expectConstraint(database.db.insert(iamGracePeriods).values({ ...row, heldBytes: -1n }), "grace_periods_held_bytes_nonnegative");
  });
});

describe("instance settings", () => {
  it("allows only one row", async () => {
    await database.db.insert(iamInstanceSettings).values({});
    await expectConstraint(database.db.insert(iamInstanceSettings).values({ id: 2 }), "instance_settings_single_row");
  });
});
