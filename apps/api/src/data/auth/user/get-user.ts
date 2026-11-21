import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";
import type { User } from "./types.js";

export async function getUserById(db: DbOrTx, userId: string): Promise<User | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  return row ?? null;
}
