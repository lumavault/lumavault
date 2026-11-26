import { Code, ConnectError } from '@connectrpc/connect'
import { createObjectClaim } from '#/data/iam/object-claim/create-object-claim.js'
import { isUniqueViolation } from '#/db/errors.js'
import type { ModuleContext } from '#/server/modules.js'

import { APP_NAMESPACE } from './constants.js'
import type { StoredServerObject, StoreServerObjectInput } from './types.js'

type Deps = Pick<ModuleContext, 'db' | 'gateway'>

/**
 * Uploads a small server-held file with the service key and claims it in the quota ledger
 * with no household billed, so read tickets, app foreign keys, and releaseObject treat it
 * like any other object.
 */
export async function storeServerObject(
  ctx: Deps,
  input: StoreServerObjectInput,
): Promise<StoredServerObject> {
  const filename = input.filename.trim()
  const mimeType = input.mimeType.trim()
  if (input.bytes.byteLength === 0) {
    throw new ConnectError(
      'empty files cannot be uploaded',
      Code.InvalidArgument,
    )
  }
  if (!filename) {
    throw new ConnectError('filename is required', Code.InvalidArgument)
  }
  if (!mimeType) {
    throw new ConnectError('mimeType is required', Code.InvalidArgument)
  }

  const stored = await ctx.gateway.upload({
    bytes: input.bytes,
    namespace: APP_NAMESPACE[input.app],
    filename,
    mimeType,
  })

  try {
    await createObjectClaim(ctx.db, {
      objectId: stored.id,
      householdId: null,
      uploadedBy: null,
      reservationId: null,
      app: input.app,
      bytes: stored.sizeBytes,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConnectError('object is already claimed', Code.AlreadyExists)
    }
    // Remove the uploaded object so a failed DB write leaves no unrecorded orphan.
    await ctx.gateway.delete(stored.id).catch(() => {})
    throw err
  }

  return {
    objectId: stored.id,
    bytes: stored.sizeBytes,
    sha256Digest: stored.sha256Digest,
    mimeType: stored.mimeType,
    filename: stored.filename,
  }
}
