import { eq } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { organization } from "#/db/schemas/auth.js";
import type { Organization } from "./types.js";

export async function getOrganizationById(db: DbOrTx, organizationId: string): Promise<Organization | null> {
  const [row] = await db.select().from(organization).where(eq(organization.id, organizationId));
  return row ?? null;
}
