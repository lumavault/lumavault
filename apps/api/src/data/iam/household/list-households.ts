import { asc, eq, gt } from "drizzle-orm";
import type { DbOrTx } from "#/db/index.js";
import { organization } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";

/** One page of organizations in ID order, each with its allowance row if it has one. */
export async function listHouseholdsAfter(db: DbOrTx, afterId: string | null, limit: number) {
  return db
    .select({ org: organization, household: iamHouseholds })
    .from(organization)
    .leftJoin(iamHouseholds, eq(iamHouseholds.householdId, organization.id))
    .where(afterId ? gt(organization.id, afterId) : undefined)
    .orderBy(asc(organization.id))
    .limit(limit);
}
