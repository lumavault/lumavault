import { Code, ConnectError } from "@connectrpc/connect";
import { and, eq, isNull } from "drizzle-orm";
import { type SignedTicket, signReadTicket } from "#/auth/tickets.js";
import { iamObjectClaims } from "#/db/schemas/iam.js";
import type { ModuleContext } from "#/modules.js";

/**
 * Signs a read ticket for an object the ledger knows about. Apps decide who may see what;
 * this only refuses objects that were never claimed or were already released.
 */
export async function signObjectReadTicket(ctx: Pick<ModuleContext, "db" | "config">, objectId: string): Promise<SignedTicket> {
  const [claim] = await ctx.db
    .select({ objectId: iamObjectClaims.objectId })
    .from(iamObjectClaims)
    .where(and(eq(iamObjectClaims.objectId, objectId), isNull(iamObjectClaims.releasedAt)));
  if (!claim) {
    throw new ConnectError("no such object", Code.NotFound);
  }
  return signReadTicket(ctx.config.ticketSecret, { objectId });
}

/** Signs a read ticket for one thumbnail chunk. */
export function signThumbnailReadTicket(ctx: Pick<ModuleContext, "config">, chunkSha256: string): SignedTicket {
  return signReadTicket(ctx.config.ticketSecret, { chunkSha256 });
}
