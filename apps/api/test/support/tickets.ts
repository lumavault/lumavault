// Test-only ticket verifier. Mirrors the Go Gateway's checks so API tests can inspect
// signed tickets without calling a running Gateway.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { TICKET_PREFIX } from '#/auth/constants.js'

const SHA256_HEX = /^[0-9a-f]{64}$/
const TICKET_CLOCK_SKEW_SECONDS = 30

export type TicketClaims =
  | { kind: 'up'; exp: number; namespace: number; maxSizeBytes: bigint }
  | { kind: 'rd'; exp: number; objectId: string }
  | { kind: 'rd'; exp: number; chunkSha256: string }

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
 * then expiry.
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
