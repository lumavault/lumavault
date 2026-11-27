import { createHmac, timingSafeEqual } from 'node:crypto'
import { SHA256_HEX } from '#/constants.js'

import {
  READ_TICKET_TTL_SECONDS,
  TICKET_CLOCK_SKEW_SECONDS,
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

export type TicketClaims =
  | { kind: 'up'; exp: number; namespace: number; maxSizeBytes: bigint }
  | { kind: 'rd'; exp: number; objectId: string }
  | { kind: 'rd'; exp: number; chunkSha256: string }

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

export class TicketError extends Error {
  constructor(
    readonly reason: 'malformed' | 'signature' | 'expired' | 'claims',
    message: string,
  ) {
    super(message)
  }
}

/**
 * Checks a ticket the way the Gateway does: signature first, in constant time, then claims,
 * then expiry. The API uses it for tickets it receives back, such as public album links.
 */
export function verifyTicket(
  secret: string,
  token: string,
  now: Date = new Date(),
): TicketClaims {
  if (!token.startsWith(TICKET_PREFIX)) {
    throw new TicketError('malformed', 'missing ticket prefix')
  }
  const parts = token.slice(TICKET_PREFIX.length).split('.')
  if (parts.length !== 2) {
    throw new TicketError('malformed', 'want prefix, payload, and signature')
  }
  const [body, sigText] = parts as [string, string]
  const sig = strictBase64url(sigText)
  if (!sig) {
    throw new TicketError('malformed', 'signature is not base64url')
  }
  const expected = mac(secret, body)
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new TicketError('signature', 'bad signature')
  }
  const raw = strictBase64url(body)
  if (!raw) {
    throw new TicketError('malformed', 'payload is not base64url')
  }
  let payload: Record<string, unknown>
  try {
    // Sizes over 2^53 must stay exact, so integers parse as bigint where JSON allows.
    payload = JSON.parse(
      raw.toString('utf8'),
      (_key, value, context?: { source?: string }) =>
        typeof value === 'number' &&
        context?.source &&
        /^\d+$/.test(context.source) &&
        !Number.isSafeInteger(value)
          ? BigInt(context.source)
          : value,
    ) as Record<string, unknown>
  } catch {
    throw new TicketError('malformed', 'payload is not JSON')
  }
  const claims = toClaims(payload)
  if (epochSeconds(now) > claims.exp + TICKET_CLOCK_SKEW_SECONDS) {
    throw new TicketError('expired', 'ticket expired')
  }
  return claims
}

function toClaims(p: Record<string, unknown>): TicketClaims {
  const exp = p.exp
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp === 0) {
    throw new TicketError('claims', 'missing exp')
  }
  if (p.k === 'up') {
    const max = typeof p.max === 'number' ? BigInt(p.max) : p.max
    if (
      typeof p.ns !== 'number' ||
      p.ns <= 0 ||
      typeof max !== 'bigint' ||
      max <= 0n
    ) {
      throw new TicketError('claims', 'upload ticket needs ns and max')
    }
    return { kind: 'up', exp, namespace: p.ns, maxSizeBytes: max }
  }
  if (p.k === 'rd') {
    const obj = typeof p.obj === 'string' && p.obj !== '' ? p.obj : undefined
    const chk = typeof p.chk === 'string' && p.chk !== '' ? p.chk : undefined
    if ((obj === undefined) === (chk === undefined)) {
      throw new TicketError(
        'claims',
        'read ticket needs exactly one of obj and chk',
      )
    }
    if (chk !== undefined && !SHA256_HEX.test(chk)) {
      throw new TicketError('claims', 'chk is not a SHA-256')
    }
    return obj !== undefined
      ? { kind: 'rd', exp, objectId: obj }
      : { kind: 'rd', exp, chunkSha256: chk! }
  }
  throw new TicketError('claims', `unknown kind ${String(p.k)}`)
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

// Node's decoder accepts loose input, so re-encode and compare to allow exactly one spelling.
function strictBase64url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    return null
  }
  const bytes = Buffer.from(text, 'base64url')
  return bytes.toString('base64url') === text ? bytes : null
}

function epochSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000)
}
