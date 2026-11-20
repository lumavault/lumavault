import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { member } from "#/db/schemas/auth.js";

/** Sets a member's role directly. Better Auth's own role changes go through its API instead. */
export async function setMemberRole(db: DbOrTx, organizationId: string, userId: string, role: string): Promise<void> {
  await db.update(member).set({ role }).where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
}
