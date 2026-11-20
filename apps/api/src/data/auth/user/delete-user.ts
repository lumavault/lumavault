import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";

/** Deletes a user. Their sessions, memberships and other rows cascade. */
export async function deleteUser(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(user).where(eq(user.id, userId));
}
