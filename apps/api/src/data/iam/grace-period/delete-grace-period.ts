import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { iamGracePeriods } from "#/db/schemas/iam.js";

/** Ends a person's grace period. */
export async function deleteGracePeriod(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(iamGracePeriods).where(eq(iamGracePeriods.userId, userId));
}
