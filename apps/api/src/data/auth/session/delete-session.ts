import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { session } from "#/db/schemas/auth.js";

/** Signs a user out everywhere: cookies and bearer tokens alike stop working on the next request. */
export async function deleteSessionsByUserId(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}
