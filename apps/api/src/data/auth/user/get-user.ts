import { and, eq, ilike, or } from "drizzle-orm";
import { keysetAfter, keysetOrder, likeContains, type PageCursor } from "#/data/sql.js";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";
import type { User } from "./types.js";

export async function getUserById(db: DbOrTx, userId: string): Promise<User | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  return row ?? null;
}

/** A page of users in creation order, optionally only those whose name or email contains query, ignoring case. */
export async function getUsers(db: DbOrTx, page: { query?: string; after?: PageCursor; limit: number }): Promise<User[]> {
  const pattern = page.query ? likeContains(page.query) : undefined;
  return db
    .select()
    .from(user)
    .where(
      and(
        pattern ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined,
        page.after ? keysetAfter(user.createdAt, user.id, page.after) : undefined,
      ),
    )
    .orderBy(...keysetOrder(user.createdAt, user.id))
    .limit(page.limit);
}
