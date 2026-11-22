import { and, eq } from "drizzle-orm";
import type { HouseholdRole } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import { member } from "#/db/schemas/auth.js";
import type { Member } from "./types.js";

/** Sets a member's role. Null when they are not in this household. */
export async function updateMemberRole(db: DbOrTx, organizationId: string, userId: string, role: HouseholdRole): Promise<Member | null> {
  const [row] = await db
    .update(member)
    .set({ role })
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .returning();
  return row ?? null;
}
