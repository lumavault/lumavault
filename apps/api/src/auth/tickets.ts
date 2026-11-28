import { createHmac } from 'node:crypto'

import {
  READ_TICKET_TTL_SECONDS,
  TICKET_PREFIX,
  UPLOAD_TICKET_TTL_SECONDS,
} from './constants.js'

export interface SignedTicket {
  ticket: string
  expiresAt: Date
}

export interface UploadTicketScope {
  /** Storage Namespace enum value the commit must use. */
  namespace: number
  /** Largest size_bytes the commit may declare. */
  maxSizeBytes: bigint
}

/** A read ticket covers one object, or one chunk such as a thumbnail. */
export type ReadTicketScope = { objectId: string } | { chunkSha256: string }

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Signs a 24-hour ticket for HasChunks, chunk uploads, and one commit into a namespace. */
export function signUploadTicket(
  secret: string,
  scope: UploadTicketScope,
  now: Date = new Date(),
): SignedTicket {
  if (scope.namespace <= 0 || scope.maxSizeBytes <= 0n) {
    throw new Error('upload tickets need a namespace and a positive max size')
  }
  const exp = epochSeconds(now) + UPLOAD_TICKET_TTL_SECONDS
  // Built by hand so 64-bit sizes keep every digit and keys keep the canonical order.
  const json = `{"k":"up","exp":${exp},"ns":${scope.namespace},"max":${scope.maxSizeBytes.toString()}}`
  return { ticket: sign(secret, json), expiresAt: new Date(exp * 1000) }
}

/** Signs a 6-hour ticket that reads one object, or one chunk such as a thumbnail. */
export function signReadTicket(
  secret: string,
  scope: ReadTicketScope,
  now: Date = new Date(),
): SignedTicket {
  const exp = epochSeconds(now) + READ_TICKET_TTL_SECONDS
  const target =
    'objectId' in scope
      ? `"obj":${JSON.stringify(scope.objectId)}`
      : `"chk":${JSON.stringify(scope.chunkSha256)}`
  if ('chunkSha256' in scope && !SHA256_HEX.test(scope.chunkSha256)) {
    throw new Error('thumbnail tickets need a lowercase hex SHA-256')
  }
  return {
    ticket: sign(secret, `{"k":"rd","exp":${exp},${target}}`),
    expiresAt: new Date(exp * 1000),
  }
}

function sign(secret: string, json: string): string {
  const body = Buffer.from(json, 'utf8').toString('base64url')
  return `${TICKET_PREFIX}${body}.${mac(secret, body).toString('base64url')}`
}

function mac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret)
    .update(TICKET_PREFIX + body)
    .digest()
}

function epochSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000)
}
