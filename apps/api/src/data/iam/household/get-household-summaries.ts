import { and, count, eq, gt, inArray, sum } from "drizzle-orm";
import { HOUSEHOLD_OWNER_ROLE } from "#/auth/constants.js";
import { keysetAfter, keysetOrder, type PageCursor } from "#/data/sql.js";
import type { DbOrTx } from "#/db/index.js";
import { invitation, member, organization, user } from "#/db/schemas/auth.js";
import { iamGracePeriods, iamHouseholds } from "#/db/schemas/iam.js";
import type { HouseholdSummary } from "./types.js";

/**
 * A page of households in creation order with their owner, member count, pending member
 * invites, and held bytes. The extra facts come from one grouped query each, not one per row.
 */
export async function getHouseholdSummaries(
  db: DbOrTx,
  page: { after?: PageCursor; limit: number; now: Date },
): Promise<HouseholdSummary[]> {
  const rows = await db
    .select({ organization, household: iamHouseholds })
    .from(iamHouseholds)
    .innerJoin(organization, eq(organization.id, iamHouseholds.householdId))
    .where(page.after ? keysetAfter(organization.createdAt, organization.id, page.after) : undefined)
    .orderBy(...keysetOrder(organization.createdAt, organization.id))
    .limit(page.limit);
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((r) => r.organization.id);

  const [owners, members, invites, held] = await Promise.all([
    db
      .select({ householdId: member.organizationId, user })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(inArray(member.organizationId, ids), eq(member.role, HOUSEHOLD_OWNER_ROLE))),
    db
      .select({ householdId: member.organizationId, n: count() })
      .from(member)
      .where(inArray(member.organizationId, ids))
      .groupBy(member.organizationId),
    db
      .select({ householdId: invitation.organizationId, n: count() })
      .from(invitation)
      .where(and(inArray(invitation.organizationId, ids), eq(invitation.status, "pending"), gt(invitation.expiresAt, page.now)))
      .groupBy(invitation.organizationId),
    db
      .select({ householdId: iamGracePeriods.householdId, total: sum(iamGracePeriods.heldBytes) })
      .from(iamGracePeriods)
      .where(inArray(iamGracePeriods.householdId, ids))
      .groupBy(iamGracePeriods.householdId),
  ]);

  const ownerBy = new Map(owners.map((o) => [o.householdId, o.user]));
  const membersBy = new Map(members.map((m) => [m.householdId, m.n]));
  const invitesBy = new Map(invites.map((i) => [i.householdId, i.n]));
  const heldBy = new Map(held.map((h) => [h.householdId, BigInt(h.total ?? 0)]));
  return rows.map(({ organization: org, household }) => ({
    organization: org,
    household,
    owner: ownerBy.get(org.id) ?? null,
    memberCount: membersBy.get(org.id) ?? 0,
    pendingInviteCount: invitesBy.get(org.id) ?? 0,
    heldBytes: heldBy.get(org.id) ?? 0n,
  }));
}
