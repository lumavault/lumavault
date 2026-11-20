import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { organization } from "#/db/schemas/auth.js";

/** The Better Auth organization behind a household, or null when there is none. */
export async function getOrganization(db: DbOrTx, organizationId: string) {
  const [org] = await db.select().from(organization).where(eq(organization.id, organizationId));
  return org ?? null;
}
