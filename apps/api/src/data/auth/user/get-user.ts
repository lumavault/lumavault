import { eq, sql } from "drizzle-orm";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import type { DbOrTx } from "#/db/index.js";
import { user } from "#/db/schemas/auth.js";

/** A user by ID, or null when there is none. */
export async function getUserById(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  return row ?? null;
}

/** Any one Super-Admin, or null when the instance has none. Roles are a comma-separated list. */
export async function getSuperAdmin(db: DbOrTx): Promise<{ id: string } | null> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`string_to_array(coalesce(${user.role}, ''), ',') @> array[${SUPER_ADMIN_ROLE}]`)
    .limit(1);
  return admin ?? null;
}
