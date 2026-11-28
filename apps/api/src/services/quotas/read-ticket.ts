import { Code, ConnectError } from '@connectrpc/connect'
import { signReadTicket, type SignedTicket } from '#/auth/tickets.js'
import { getActiveObjectClaim } from '#/data/iam/object-claim/get-object-claim.js'
import type { ModuleContext } from '#/server/modules.js'

/**
 * Signs a read ticket for an object the ledger knows about. Apps decide who may see what;
 * this only refuses objects that were never claimed or were already released.
 */
export async function signObjectReadTicket(
  ctx: Pick<ModuleContext, 'db' | 'config'>,
  objectId: string,
): Promise<SignedTicket> {
  const claim = await getActiveObjectClaim(ctx.db, objectId)
  if (!claim) {
    throw new ConnectError('no such object', Code.NotFound)
  }
  return signReadTicket(ctx.config.ticketSecret, { objectId })
}
