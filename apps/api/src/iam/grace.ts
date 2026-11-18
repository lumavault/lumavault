import { and, eq, inArray, isNull, sum } from "drizzle-orm";
import { iamGracePeriods, iamObjectClaims } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";
import { GRACE_PERIOD_DAYS } from "./constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every stored object that is this person's private data in the household, across all apps. */
export async function privateObjectsOf(ctx: ModuleContext, userId: string, householdId: string): Promise<string[]> {
  const lists = await Promise.all(ctx.apps.map((a) => a.privateObjects(ctx, userId, householdId)));
  return [...new Set(lists.flat())];
}

/** Bytes billed for these objects that have not been released. */
export async function billedBytes(ctx: Pick<ModuleContext, "db">, objectIds: string[]): Promise<bigint> {
  if (objectIds.length === 0) {
    return 0n;
  }
  const [row] = await ctx.db
    .select({ total: sum(iamObjectClaims.bytes) })
    .from(iamObjectClaims)
    .where(and(inArray(iamObjectClaims.objectId, objectIds), isNull(iamObjectClaims.releasedAt)));
  return BigInt(row?.total ?? 0);
}

/**
 * Starts a person's grace period after they leave or are removed from a household. Their
 * private data stays where it is, still billed to that household, until the grace period
 * ends or they join another household.
 */
export async function startGracePeriod(
  ctx: ModuleContext,
  userId: string,
  household: { id: string; name: string },
  now: Date = new Date(),
): Promise<void> {
  const heldBytes = await billedBytes(ctx, await privateObjectsOf(ctx, userId, household.id));
  const row = {
    userId,
    householdId: household.id,
    householdName: household.name,
    heldBytes,
    startedAt: now,
    deleteAt: new Date(now.getTime() + GRACE_PERIOD_DAYS * DAY_MS),
  };
  await ctx.db.insert(iamGracePeriods).values(row).onConflictDoUpdate({ target: iamGracePeriods.userId, set: row });
}

/** Ends a grace period, after its data moved or was deleted. */
export async function endGracePeriod(ctx: Pick<ModuleContext, "db">, userId: string): Promise<void> {
  await ctx.db.delete(iamGracePeriods).where(eq(iamGracePeriods.userId, userId));
}
