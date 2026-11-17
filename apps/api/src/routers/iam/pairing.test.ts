import { Code, ConnectError } from "@connectrpc/connect";
import { PairingStatus } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#/app.js";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { iamHouseholds, iamPairingRequests } from "#/db/schemas/iam.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#/db/testing.js";
import { PAIRING_CODE_ALPHABET, PAIRING_STARTS_PER_WINDOW } from "#/iam/constants.js";
import { RateLimiter } from "#/iam/rate-limit.js";
import { loadModules, type ModuleContext } from "#/modules.js";
import { createTestContext, signUp, type TestUser } from "#/testing/context.js";
import { iamClient } from "#/testing/rpc.js";
import { newPairingCode } from "./pairing.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let ada: TestUser;
let householdId: string;

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
  ctx = createTestContext(database);
  app = createApp(ctx, await loadModules());
  ada = await signUp(ctx, "ada@example.com");
  householdId = (await createHouseholdFor(ctx, ada.id, "Home")).id;
  await database.db.insert(iamHouseholds).values({ householdId, storageCapBytes: 1n });
});

afterAll(async () => {
  await database?.drop();
});

describe("codes", () => {
  it("are 6 characters from the 32-character alphabet without lookalikes", () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (let i = 0; i < 200; i++) {
      expect(newPairingCode()).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    }
  });
});

describe("pairing an Apple TV", () => {
  it("hands the Apple TV a bearer session exactly once after approval", async () => {
    const tv = iamClient(app);
    const start = await tv.startPairing({ deviceName: "Living Room" });
    expect(start.pollIntervalSeconds).toBe(5);
    const poll = () => tv.pollPairing({ pairingId: start.pairingId, deviceSecret: start.deviceSecret });

    expect((await poll()).status).toBe(PairingStatus.PENDING);
    const approved = await iamClient(app, ada.headers).approvePairing({ code: start.code.toLowerCase(), householdId });
    expect(approved.deviceName).toBe("Living Room");

    const [first, second] = await Promise.all([poll(), poll()]);
    const winners = [first, second].filter((p) => p.status === PairingStatus.APPROVED);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.householdId).toBe(householdId);

    const viewer = await iamClient(app, new Headers({ authorization: `Bearer ${winners[0]!.sessionToken}` })).getViewer({});
    expect(viewer.user?.email).toBe("ada@example.com");
    expect(viewer.activeHouseholdId).toBe(householdId);

    expect((await poll()).status).toBe(PairingStatus.EXPIRED);
    expect(await codeOf(iamClient(app, ada.headers).approvePairing({ code: start.code, householdId }))).toBe(Code.NotFound);
  });

  it("burns a pairing after 5 wrong device secrets", async () => {
    const tv = iamClient(app);
    const start = await tv.startPairing({ deviceName: "Den" });
    for (let i = 0; i < 5; i++) {
      expect(await codeOf(tv.pollPairing({ pairingId: start.pairingId, deviceSecret: "guess" }))).toBe(Code.PermissionDenied);
    }
    expect(await codeOf(iamClient(app, ada.headers).approvePairing({ code: start.code, householdId }))).toBe(Code.NotFound);
    expect((await tv.pollPairing({ pairingId: start.pairingId, deviceSecret: start.deviceSecret })).status).toBe(PairingStatus.EXPIRED);
  });

  it("requires the approver to belong to the household they pick", async () => {
    const start = await iamClient(app).startPairing({ deviceName: "Bedroom" });
    const eve = await signUp(ctx, "eve@example.com");
    expect(await codeOf(iamClient(app, eve.headers).approvePairing({ code: start.code, householdId }))).toBe(Code.PermissionDenied);
    expect(await codeOf(iamClient(app).approvePairing({ code: start.code, householdId }))).toBe(Code.Unauthenticated);
  });

  it("refuses expired codes", async () => {
    const tv = iamClient(app);
    const start = await tv.startPairing({ deviceName: "Garage" });
    await database.db
      .update(iamPairingRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(iamPairingRequests.id, start.pairingId));
    expect(await codeOf(iamClient(app, ada.headers).approvePairing({ code: start.code, householdId }))).toBe(Code.NotFound);
    expect((await tv.pollPairing({ pairingId: start.pairingId, deviceSecret: start.deviceSecret })).status).toBe(PairingStatus.EXPIRED);
  });

  it("stores only the hash of the device secret", async () => {
    const start = await iamClient(app).startPairing({ deviceName: "Office" });
    const [row] = await database.db.select().from(iamPairingRequests).where(eq(iamPairingRequests.id, start.pairingId));
    expect(row?.deviceSecretHash).not.toContain(start.deviceSecret);
    expect(row?.deviceSecretHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rate limits", () => {
  it("limit code creation per address", async () => {
    const fresh = createApp(ctx, await loadModules());
    const tv = iamClient(fresh);
    for (let i = 0; i < PAIRING_STARTS_PER_WINDOW; i++) {
      await tv.startPairing({ deviceName: `TV ${i}` });
    }
    expect(await codeOf(tv.startPairing({ deviceName: "one too many" }))).toBe(Code.ResourceExhausted);
  });

  it("reset after the window", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect([limiter.allow("ip"), limiter.allow("ip"), limiter.allow("ip")]).toEqual([true, true, false]);
    expect(limiter.allow("other")).toBe(true);
    now = 1000;
    expect(limiter.allow("ip")).toBe(true);
  });
});
