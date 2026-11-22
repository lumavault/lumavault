import type { DbOrTx } from "#/db/index.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";
import type { GracePeriod, NewGracePeriod } from "./types.js";

/** Starts a user's grace period, replacing any earlier one, since a user has at most one. */
export async function upsertGracePeriod(db: DbOrTx, input: NewGracePeriod): Promise<GracePeriod> {
  const [row] = await db
    .insert(iamGracePeriods)
    .values(input)
    .onConflictDoUpdate({ target: iamGracePeriods.userId, set: input })
    .returning();
  if (!row) {
    throw new Error("grace period upsert returned no row");
  }
  return row;
}
