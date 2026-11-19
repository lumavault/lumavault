import { randomUUID } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyTicket } from "#/auth/tickets.js";
import { organization, user } from "#/db/schemas/auth.js";
import { iamHouseholds, iamObjectClaims, iamUploadReservations } from "#/db/schemas/iam.js";
import { createMigratedTestDatabase, type TestDatabase } from "#/db/testing.js";
import type { ModuleContext } from "#/modules.js";
import { createTestContext } from "#/testing/context.js";
import type { StorageGateway, StoredObject } from "#/services/storage-gateway.js";
import {
  APP_NAMESPACE,
  cancelReservation,
  copyObjectToHousehold,
  expireReservations,
  finishUpload,
  moveObjects,
  releaseObject,
  reserveUpload,
  signObjectReadTicket,
} from "./index.js";

/** An in-memory Gateway: tests "commit" objects by adding them here. */
class FakeGateway implements StorageGateway {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];

  commit(app: "photos" | "cinema" | "arcade", sizeBytes: bigint): string {
    const id = randomUUID();
    this.objects.set(id, { id, namespace: APP_NAMESPACE[app], sizeBytes, sha256Digest: "0".repeat(64) });
    return id;
  }

  async stat(objectId: string) {
    return this.objects.get(objectId) ?? null;
  }

  async delete(objectId: string) {
    this.deleted.push(objectId);
    this.objects.delete(objectId);
  }

  async setThumbnail() {}

  async copy(objectId: string) {
    const source = this.objects.get(objectId);
    if (!source) throw new ConnectError("not found", Code.NotFound);
    const id = randomUUID();
    this.objects.set(id, { ...source, id });
    return this.objects.get(id)!;
  }
}

let database: TestDatabase;
let ctx: ModuleContext;
let gateway: FakeGateway;
let userId: string;
let householdId: string;

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

async function usage() {
  const [h] = await database.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, householdId));
  return { used: h!.usedBytes, reserved: h!.reservedBytes };
}

async function setCap(storageCapBytes: bigint) {
  await database.db.update(iamHouseholds).set({ storageCapBytes }).where(eq(iamHouseholds.householdId, householdId));
}

const reserve = (sizeBytes: bigint, app: "photos" | "cinema" = "photos") =>
  reserveUpload(ctx, { userId, app, sizeBytes, billing: { kind: "household", householdId } });

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  gateway = new FakeGateway();
  ctx = createTestContext(database, { gateway });
  userId = randomUUID();
  await database.db.insert(user).values({ id: userId, name: "Ada", email: "ada@example.com" });
});

beforeEach(async () => {
  householdId = randomUUID();
  await database.db.insert(organization).values({ id: householdId, name: "Home", slug: householdId, createdAt: new Date() });
  await database.db.insert(iamHouseholds).values({ householdId, storageCapBytes: 1000n, enabledApps: ["photos", "cinema"] });
});

afterAll(async () => {
  await database?.drop();
});

describe("reserve", () => {
  it("holds bytes against the cap and refuses what does not fit", async () => {
    await reserve(600n);
    expect(await usage()).toEqual({ used: 0n, reserved: 600n });
    expect(await codeOf(reserve(401n))).toBe(Code.ResourceExhausted);
    await reserve(400n);
  });

  it("allows exactly as many parallel reservations as fit", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => codeOf(reserve(100n))));
    expect(results.filter((r) => r === "ok")).toHaveLength(10);
    expect(results.filter((r) => r === Code.ResourceExhausted)).toHaveLength(15);
    expect(await usage()).toEqual({ used: 0n, reserved: 1000n });
  });

  it("refuses disabled apps and suspended households", async () => {
    expect(await codeOf(reserveUpload(ctx, { userId, app: "arcade", sizeBytes: 1n, billing: { kind: "household", householdId } }))).toBe(
      Code.FailedPrecondition,
    );
    await database.db.update(iamHouseholds).set({ suspended: true }).where(eq(iamHouseholds.householdId, householdId));
    expect(await codeOf(reserve(1n))).toBe(Code.PermissionDenied);
  });

  it("bills nothing for the shared Cinema library, and has none for Photos", async () => {
    const shared = await reserveUpload(ctx, { userId, app: "cinema", sizeBytes: 10n ** 12n, billing: { kind: "shared" } });
    expect(shared.householdId).toBeNull();
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
    expect(await codeOf(reserveUpload(ctx, { userId, app: "photos", sizeBytes: 1n, billing: { kind: "shared" } }))).toBe(
      Code.InvalidArgument,
    );
  });
});

describe("finish", () => {
  it("bills the real size and refunds the rest of the reservation", async () => {
    const r = await reserve(500n);
    const objectId = gateway.commit("photos", 300n);
    expect(await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId })).toEqual({ objectId, householdId, bytes: 300n });
    expect(await usage()).toEqual({ used: 300n, reserved: 0n });
  });

  it("is safe to repeat with the same object", async () => {
    const r = await reserve(50n);
    const objectId = gateway.commit("photos", 50n);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    expect(await usage()).toEqual({ used: 50n, reserved: 0n });
  });

  it("checks the object exists, matches the app, and fits the reservation", async () => {
    const r = await reserve(100n);
    expect(await codeOf(finishUpload(ctx, { userId, reservationId: r.reservationId, objectId: "missing" }))).toBe(Code.NotFound);
    const cinema = gateway.commit("cinema", 10n);
    expect(await codeOf(finishUpload(ctx, { userId, reservationId: r.reservationId, objectId: cinema }))).toBe(Code.InvalidArgument);
    const big = gateway.commit("photos", 101n);
    expect(await codeOf(finishUpload(ctx, { userId, reservationId: r.reservationId, objectId: big }))).toBe(Code.InvalidArgument);
    expect(await codeOf(finishUpload(ctx, { userId: "someone-else", reservationId: r.reservationId, objectId: big }))).toBe(
      Code.PermissionDenied,
    );
    expect(await codeOf(finishUpload(ctx, { userId, reservationId: "not-a-uuid", objectId: big }))).toBe(Code.NotFound);
  });

  it("never lets a second reservation claim an object, even when they race", async () => {
    const reservations = await Promise.all(Array.from({ length: 5 }, () => reserve(100n)));
    const objectId = gateway.commit("photos", 100n);
    const results = await Promise.all(
      reservations.map((r) => codeOf(finishUpload(ctx, { userId, reservationId: r.reservationId, objectId }))),
    );
    expect(results.filter((c) => c === "ok")).toHaveLength(1);
    expect(results.filter((c) => c === Code.AlreadyExists)).toHaveLength(4);
    expect((await usage()).used).toBe(100n);
  });

  it("charges a late finish directly after the sweeper refunded it", async () => {
    const r = await reserve(100n);
    await backdate(r.reservationId);
    expect(await expireReservations(ctx)).toBeGreaterThanOrEqual(1);
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
    const objectId = gateway.commit("photos", 80n);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    expect(await usage()).toEqual({ used: 80n, reserved: 0n });
  });

  it("deletes a late upload that no longer fits, leaving no orphan", async () => {
    const r = await reserve(100n);
    await backdate(r.reservationId);
    await expireReservations(ctx);
    await setCap(50n);
    const objectId = gateway.commit("photos", 80n);
    expect(await codeOf(finishUpload(ctx, { userId, reservationId: r.reservationId, objectId }))).toBe(Code.ResourceExhausted);
    expect(gateway.objects.has(objectId)).toBe(false);
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
  });
});

describe("cancel and release", () => {
  it("cancelling twice refunds once", async () => {
    const r = await reserve(300n);
    await Promise.all([1, 2, 3].map(() => cancelReservation(ctx, { userId, reservationId: r.reservationId })));
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
  });

  it("releasing a deleted object refunds exactly once and deletes it from the Gateway", async () => {
    const r = await reserve(200n);
    const objectId = gateway.commit("photos", 200n);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    const results = await Promise.all(Array.from({ length: 6 }, () => releaseObject(ctx, objectId)));
    expect(results.map((r) => r.refunded).filter((b) => b > 0n)).toEqual([200n]);
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
    expect(gateway.objects.has(objectId)).toBe(false);
  });
});

describe("cap changes", () => {
  it("a cap lowered below usage blocks new uploads but nothing else", async () => {
    const r = await reserve(500n);
    const objectId = gateway.commit("photos", 500n);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    await setCap(100n);
    expect(await codeOf(reserve(1n))).toBe(Code.ResourceExhausted);
    await releaseObject(ctx, objectId);
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
  });
});

describe("under concurrent load", () => {
  it("never deadlocks and keeps the books balanced", async () => {
    await setCap(10n ** 9n);
    const reservations = await Promise.all(Array.from({ length: 40 }, () => reserve(1000n)));
    await Promise.all(reservations.slice(30).map((r) => backdate(r.reservationId)));

    const work = reservations.map((r, i) => {
      if (i % 3 === 0) return cancelReservation(ctx, { userId, reservationId: r.reservationId });
      const objectId = gateway.commit("photos", 600n);
      return finishUpload(ctx, { userId, reservationId: r.reservationId, objectId }).then((f) =>
        i % 2 === 0 ? releaseObject(ctx, f.objectId) : undefined,
      );
    });
    const sweeps = [expireReservations(ctx), expireReservations(ctx), expireReservations(ctx)];
    const outcomes = await Promise.allSettled([...work, ...sweeps]);
    const deadlocks = outcomes.filter((o) => o.status === "rejected" && /deadlock/i.test(String(o.reason)));
    expect(deadlocks).toEqual([]);

    // Used bytes always equal the unreleased claims; reserved bytes equal pending reservations.
    const [claims] = await database.db
      .select({ total: sql<string>`coalesce(sum(${iamObjectClaims.bytes}), 0)` })
      .from(iamObjectClaims)
      .where(sql`${iamObjectClaims.householdId} = ${householdId} and ${iamObjectClaims.releasedAt} is null`);
    const [pending] = await database.db
      .select({ total: sql<string>`coalesce(sum(${iamUploadReservations.bytes}), 0)` })
      .from(iamUploadReservations)
      .where(sql`${iamUploadReservations.householdId} = ${householdId} and ${iamUploadReservations.status} = 'pending'`);
    expect(await usage()).toEqual({ used: BigInt(claims!.total), reserved: BigInt(pending!.total) });
  });
});

describe("moving and copying between households", () => {
  async function otherHousehold(cap: bigint): Promise<string> {
    const id = randomUUID();
    await database.db.insert(organization).values({ id, name: "Other", slug: id, createdAt: new Date() });
    await database.db.insert(iamHouseholds).values({ householdId: id, storageCapBytes: cap, enabledApps: ["photos"] });
    return id;
  }

  async function usageOf(id: string) {
    const [h] = await database.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, id));
    return { used: h!.usedBytes, reserved: h!.reservedBytes };
  }

  async function stored(bytes: bigint): Promise<string> {
    const r = await reserve(bytes);
    const objectId = gateway.commit("photos", bytes);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    return objectId;
  }

  it("records who uploaded each object", async () => {
    const objectId = await stored(5n);
    const [claim] = await database.db.select().from(iamObjectClaims).where(eq(iamObjectClaims.objectId, objectId));
    expect(claim?.uploadedBy).toBe(userId);
  });

  it("moves private data to the new household, all or nothing", async () => {
    const a = await stored(100n);
    const b = await stored(200n);
    const target = await otherHousehold(1000n);
    expect(await moveObjects(ctx, [a, b], householdId, target)).toEqual({ bytes: 300n, count: 2 });
    expect(await usage()).toEqual({ used: 0n, reserved: 0n });
    expect(await usageOf(target)).toEqual({ used: 300n, reserved: 0n });
    // Moving again changes nothing.
    expect(await moveObjects(ctx, [a, b], householdId, target)).toEqual({ bytes: 0n, count: 0 });
  });

  it("refuses a move that does not fit, leaving both households as they were", async () => {
    const a = await stored(400n);
    const tight = await otherHousehold(100n);
    expect(await codeOf(moveObjects(ctx, [a], householdId, tight))).toBe(Code.ResourceExhausted);
    expect(await usage()).toEqual({ used: 400n, reserved: 0n });
    expect(await usageOf(tight)).toEqual({ used: 0n, reserved: 0n });
  });

  it("refuses objects that are not in the household they move from, changing nothing", async () => {
    const a = await stored(100n);
    const elsewhere = await otherHousehold(1000n);
    const target = await otherHousehold(1000n);
    expect(await codeOf(moveObjects(ctx, [a], elsewhere, target))).toBe(Code.FailedPrecondition);
    expect(await usage()).toEqual({ used: 100n, reserved: 0n });
    expect(await usageOf(target)).toEqual({ used: 0n, reserved: 0n });
  });

  it("copies a shared item so both households keep one, and removes a copy that does not fit", async () => {
    const a = await stored(50n);
    const target = await otherHousehold(1000n);
    const copy = await copyObjectToHousehold(ctx, a, target, userId);
    expect(copy.objectId).not.toBe(a);
    expect(await usage()).toEqual({ used: 50n, reserved: 0n });
    expect(await usageOf(target)).toEqual({ used: 50n, reserved: 0n });

    const tiny = await otherHousehold(10n);
    const before = gateway.objects.size;
    expect(await codeOf(copyObjectToHousehold(ctx, a, tiny, userId))).toBe(Code.ResourceExhausted);
    expect(gateway.objects.size).toBe(before);
  });
});

describe("read tickets", () => {
  it("are signed only for claimed, unreleased objects", async () => {
    const r = await reserve(10n);
    const objectId = gateway.commit("photos", 10n);
    expect(await codeOf(signObjectReadTicket(ctx, objectId))).toBe(Code.NotFound);
    await finishUpload(ctx, { userId, reservationId: r.reservationId, objectId });
    const { ticket } = await signObjectReadTicket(ctx, objectId);
    expect(verifyTicket(ctx.config.ticketSecret, ticket)).toMatchObject({ kind: "rd", objectId });
    await releaseObject(ctx, objectId);
    expect(await codeOf(signObjectReadTicket(ctx, objectId))).toBe(Code.NotFound);
  });
});

async function backdate(reservationId: string) {
  await database.db
    .update(iamUploadReservations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(iamUploadReservations.id, reservationId));
}
