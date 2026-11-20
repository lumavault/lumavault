import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { organization } from "#/db/schemas/auth.js";

/** Deletes an organization. Its members, invitations and allowance row go with it. */
export async function deleteOrganization(db: DbOrTx, organizationId: string): Promise<void> {
  await db.delete(organization).where(eq(organization.id, organizationId));
}
