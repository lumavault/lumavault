import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";
import type { User } from "./types.js";

/** Bans a user with no end date. Null when the user does not exist. */
export async function banUser(db: DbOrTx, userId: string, reason: string): Promise<User | null> {
  const [row] = await db.update(user).set({ banned: true, banReason: reason, banExpires: null }).where(eq(user.id, userId)).returning();
  return row ?? null;
}

/** Lifts a ban. Null when the user does not exist. */
export async function unbanUser(db: DbOrTx, userId: string): Promise<User | null> {
  const [row] = await db.update(user).set({ banned: false, banReason: null, banExpires: null }).where(eq(user.id, userId)).returning();
  return row ?? null;
}
