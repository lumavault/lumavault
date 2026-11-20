import { and, eq } from "drizzle-orm";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import { member } from "#/db/schemas/auth.js";

/** The user ID of the household's Owner, or null when it somehow has none. */
export async function getOwnerUserId(db: DbOrTx, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, HOUSEHOLD_OWNER_ROLE)))
    .limit(1);
  return row?.userId ?? null;
}
