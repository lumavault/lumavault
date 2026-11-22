import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { member } from "#/db/schemas/auth.js";

export async function deleteMember(db: DbOrTx, organizationId: string, userId: string): Promise<void> {
  await db.delete(member).where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
}
