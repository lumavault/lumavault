import { Code, ConnectError } from "@connectrpc/connect";
import { PairingStatus } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHouseholdFor } from "#/auth/server-helpers.js";
import { iamHouseholds, iamPairingRequests } from "#/db/schemas/iam.js";
import {
  PAIRING_APPROVALS_PER_WINDOW,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MAX_FAILED_ATTEMPTS,
  PAIRING_POLLS_PER_WINDOW,
  PAIRING_STARTS_PER_WINDOW,
} from "#/iam/constants.js";
import { newPairingCode } from "#/routers/iam/pairing.js";
import { createApp } from "#/server/app.js";
import { loadModules, type ModuleContext } from "#/server/modules.js";
import { createTestContext, signUp, type TestUser } from "#test/support/context.js";
import { createTestDatabase, pushAllSchemas, type TestDatabase } from "#test/support/db.js";
import { iamClient } from "#test/support/rpc.js";

let database: TestDatabase;
let ctx: ModuleContext;
let app: Hono;
let approver: TestUser;
let loner: TestUser;
let householdId: string;
let nextIp = 1;

async function codeOf(promise: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return ConnectError.from(err).code;
  }
}

// Each Apple TV gets its own address, so one test's rate limits never touch another's.
function tv(ip = `203.0.113.${nextIp++}`) {
  return iamClient(app, new Headers({ "x-forwarded-for": ip }));
}

beforeAll(async () => {
  database = await createTestDatabase();
  await pushAllSchemas(database);
  ctx = createTestContext(database, { env: { LUMAVAULT_TRUST_PROXY: "true" } });
  app = createApp(ctx, await loadModules());

  approver = await signUp(ctx, "approver@example.com");
  loner = await signUp(ctx, "loner@example.com");
  householdId = (await createHouseholdFor(ctx, approver.id, "Home")).id;
  await database.db.insert(iamHouseholds).values({ householdId });
});

afterAll(async () => {
  await database?.drop();
});

describe("pairing codes", () => {
  it("are 6 characters from the lookalike-free alphabet", () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (let i = 0; i < 100; i++) {
      const code = newPairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      expect([...code].every((c) => PAIRING_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });
});

describe("Apple TV pairing", () => {
  it("signs the Apple TV in as the approver, handing out the session exactly once", async () => {
    const device = tv();
    const started = await device.startPairing({ deviceName: "Living Room" });
    const expiresInMs = Number(started.expiresAt!.seconds) * 1000 - Date.now();
    expect(expiresInMs).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(started.pollIntervalSeconds).toBe(5);

    const poll = { pairingId: started.pairingId, deviceSecret: started.deviceSecret };
    expect((await device.pollPairing(poll)).status).toBe(PairingStatus.PENDING);

    // Typed the way people do: lowercase, with a dash.
    const typed = `${started.code.slice(0, 3)}-${started.code.slice(3)}`.toLowerCase();
    expect((await iamClient(app, approver.headers).approvePairing({ code: typed })).deviceName).toBe("Living Room");

    const approved = await device.pollPairing(poll);
    expect(approved.status).toBe(PairingStatus.APPROVED);
    const viewer = await iamClient(app, new Headers({ authorization: `Bearer ${approved.sessionToken}` })).getViewer({});
    expect(viewer.user!.id).toBe(approver.id);

    expect(await device.pollPairing(poll)).toMatchObject({ status: PairingStatus.EXPIRED, sessionToken: "" });
  });

  it("lets each code be approved only once", async () => {
    const { code } = await tv().startPairing({ deviceName: "Den" });
    await iamClient(app, approver.headers).approvePairing({ code });
    expect(await codeOf(iamClient(app, approver.headers).approvePairing({ code }))).toBe(Code.NotFound);
  });

  it("gives the session to only one of two racing polls", async () => {
    const device = tv();
    const started = await device.startPairing({ deviceName: "Bedroom" });
    await iamClient(app, approver.headers).approvePairing({ code: started.code });
    const poll = { pairingId: started.pairingId, deviceSecret: started.deviceSecret };
    const results = await Promise.all([device.pollPairing(poll), device.pollPairing(poll)]);
    expect(results.map((r) => r.status).sort()).toEqual([PairingStatus.APPROVED, PairingStatus.EXPIRED]);
  });

  it("requires the approver to be in a household", async () => {
    const { code } = await tv().startPairing({ deviceName: "Kitchen" });
    expect(await codeOf(iamClient(app, loner.headers).approvePairing({ code }))).toBe(Code.FailedPrecondition);
    expect(await codeOf(tv().approvePairing({ code }))).toBe(Code.Unauthenticated);
  });

  it("refuses expired codes and reports them expired to the Apple TV", async () => {
    const device = tv();
    const started = await device.startPairing({ deviceName: "Garage" });
    await database.db
      .update(iamPairingRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(iamPairingRequests.id, started.pairingId));
    expect(await codeOf(iamClient(app, approver.headers).approvePairing({ code: started.code }))).toBe(Code.NotFound);
    expect((await device.pollPairing({ pairingId: started.pairingId, deviceSecret: started.deviceSecret })).status).toBe(
      PairingStatus.EXPIRED,
    );
  });

  it("burns a pairing after 5 polls with a wrong device secret, even once approved", async () => {
    const device = tv();
    const started = await device.startPairing({ deviceName: "Attic" });
    await iamClient(app, approver.headers).approvePairing({ code: started.code });
    for (let i = 0; i < PAIRING_MAX_FAILED_ATTEMPTS; i++) {
      expect(await codeOf(device.pollPairing({ pairingId: started.pairingId, deviceSecret: "guess" }))).toBe(Code.PermissionDenied);
    }
    expect(await device.pollPairing({ pairingId: started.pairingId, deviceSecret: started.deviceSecret })).toMatchObject({
      status: PairingStatus.EXPIRED,
      sessionToken: "",
    });
  });

  it("does not burn a pairing after 4 wrong secrets", async () => {
    const device = tv();
    const started = await device.startPairing({ deviceName: "Office" });
    for (let i = 0; i < PAIRING_MAX_FAILED_ATTEMPTS - 1; i++) {
      await codeOf(device.pollPairing({ pairingId: started.pairingId, deviceSecret: "guess" }));
    }
    expect((await device.pollPairing({ pairingId: started.pairingId, deviceSecret: started.deviceSecret })).status).toBe(
      PairingStatus.PENDING,
    );
  });

  it("rejects a missing or overlong device name", async () => {
    expect(await codeOf(tv().startPairing({ deviceName: " " }))).toBe(Code.InvalidArgument);
    expect(await codeOf(tv().startPairing({ deviceName: "x".repeat(101) }))).toBe(Code.InvalidArgument);
  });

  it("returns NotFound for an unknown pairing ID", async () => {
    expect(await codeOf(tv().pollPairing({ pairingId: "not-a-uuid", deviceSecret: "s" }))).toBe(Code.NotFound);
  });
});

describe("pairing rate limits", () => {
  it("limits StartPairing per IP", async () => {
    const ip = "198.51.100.1";
    for (let i = 0; i < PAIRING_STARTS_PER_WINDOW; i++) {
      await tv(ip).startPairing({ deviceName: "TV" });
    }
    expect(await codeOf(tv(ip).startPairing({ deviceName: "TV" }))).toBe(Code.ResourceExhausted);
    expect(await codeOf(tv().startPairing({ deviceName: "TV" }))).toBe("ok");
  });

  it("limits PollPairing per IP", async () => {
    const ip = "198.51.100.2";
    const started = await tv(ip).startPairing({ deviceName: "TV" });
    const poll = { pairingId: started.pairingId, deviceSecret: started.deviceSecret };
    for (let i = 0; i < PAIRING_POLLS_PER_WINDOW; i++) {
      await tv(ip).pollPairing(poll);
    }
    expect(await codeOf(tv(ip).pollPairing(poll))).toBe(Code.ResourceExhausted);
    expect(await codeOf(tv().pollPairing(poll))).toBe("ok");
  });

  it("limits ApprovePairing per user, so codes cannot be guessed", async () => {
    const guesser = await signUp(ctx, "guesser@example.com");
    const ownHousehold = (await createHouseholdFor(ctx, guesser.id, "Guessers")).id;
    await database.db.insert(iamHouseholds).values({ householdId: ownHousehold });
    for (let i = 0; i < PAIRING_APPROVALS_PER_WINDOW; i++) {
      expect(await codeOf(iamClient(app, guesser.headers).approvePairing({ code: "ZZZZZZ" }))).toBe(Code.NotFound);
    }
    expect(await codeOf(iamClient(app, guesser.headers).approvePairing({ code: "ZZZZZZ" }))).toBe(Code.ResourceExhausted);
  });
});
