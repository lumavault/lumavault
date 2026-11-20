import type { DbOrTx } from "#/db/index.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";
import type { NewGracePeriod } from "./types.js";

/** Starts a grace period, replacing the one the person already has. */
export async function upsertGracePeriod(db: DbOrTx, row: NewGracePeriod): Promise<void> {
  await db.insert(iamGracePeriods).values(row).onConflictDoUpdate({ target: iamGracePeriods.userId, set: row });
}
