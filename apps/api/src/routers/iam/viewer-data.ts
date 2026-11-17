import type { MessageInitShape } from "@bufbuild/protobuf";
import type { GetViewerResponseSchema } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { asc, eq } from "drizzle-orm";
import type { HouseholdRole } from "#/auth/constants.js";
import type { Db } from "#/db/index.js";
import { member, organization, user } from "#/db/schemas/auth.js";
import { iamHouseholds } from "#/db/schemas/iam.js";
import { roleToWire } from "./convert.js";
import { householdMessage, usageMessage, userMessage } from "./messages.js";

/** Everything a client needs about who is signed in. Reads the database, not the request. */
export async function buildViewer(
  db: Db,
  userId: string,
  activeHouseholdId: string | null,
): Promise<MessageInitShape<typeof GetViewerResponseSchema>> {
  const [u] = await db.select().from(user).where(eq(user.id, userId));
  if (!u) {
    throw new Error(`user ${userId} disappeared`);
  }
  const rows = await db
    .select({ org: organization, role: member.role, household: iamHouseholds })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(iamHouseholds, eq(iamHouseholds.householdId, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));

  const active = rows.find((r) => r.org.id === activeHouseholdId);
  return {
    user: userMessage(u),
    memberships: rows.map((r) => ({
      household: householdMessage(r.org, r.household ?? undefined),
      role: roleToWire(r.role as HouseholdRole),
    })),
    activeHouseholdId: active ? active.org.id : "",
    activeUsage: active ? usageMessage(active.household ?? undefined) : undefined,
  };
}
