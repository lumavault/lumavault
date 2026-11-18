import { count, eq, lte } from "drizzle-orm";
import { member } from "#/db/schemas/auth.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";
import { closeHousehold, deletePrivateData } from "#/iam/moves.js";
import type { ApiModule, ModuleContext } from "#/modules.js";

// Grace periods last 30 days, so checking every hour deletes data within an hour of its date.
export const GRACE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes the private data of everyone whose grace period has ended, refunding the household
 * that held it. A household its last member left is closed once their grace period ends.
 * Returns how many grace periods ended.
 */
export async function expireGracePeriods(ctx: ModuleContext, now: Date = new Date()): Promise<number> {
  const due = await ctx.db.select().from(iamGracePeriods).where(lte(iamGracePeriods.deleteAt, now));
  for (const grace of due) {
    await deletePrivateData(ctx, grace.userId, grace.householdId);
    const [left] = await ctx.db.select({ n: count() }).from(member).where(eq(member.organizationId, grace.householdId));
    const [waiting] = await ctx.db.select({ n: count() }).from(iamGracePeriods).where(eq(iamGracePeriods.householdId, grace.householdId));
    if ((left?.n ?? 0) === 0 && (waiting?.n ?? 0) === 0) {
      await closeHousehold(ctx, grace.householdId);
    }
  }
  return due.length;
}

let timer: NodeJS.Timeout | undefined;
let running: Promise<void> = Promise.resolve();

export const module: ApiModule = {
  name: "iam-grace",
  start(ctx) {
    const tick = () => {
      running = running.then(() =>
        expireGracePeriods(ctx).then(
          () => undefined,
          (err) => console.error("grace period sweep failed", err),
        ),
      );
    };
    tick();
    timer = setInterval(tick, GRACE_SWEEP_INTERVAL_MS);
    timer.unref();
  },
  async stop() {
    clearInterval(timer);
    await running;
  },
};
