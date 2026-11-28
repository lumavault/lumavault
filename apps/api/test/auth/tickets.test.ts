import { readFileSync } from 'node:fs'
import {
  READ_TICKET_TTL_SECONDS,
  UPLOAD_TICKET_TTL_SECONDS,
} from '#/auth/constants.js'
import { signReadTicket, signUploadTicket } from '#/auth/tickets.js'
import { TicketError, verifyTicket } from '#test/support/tickets.js'
import { describe, expect, it } from 'vitest'

interface Vectors {
  secret: string
  now: number
  valid: {
    name: string
    token: string
    claims: {
      k: string
      exp: number
      ns?: number
      max?: number
      obj?: string
      chk?: string
    }
  }[]
  invalid: { name: string; token: string; error: TicketError['reason'] }[]
}

const vectors = JSON.parse(
  readFileSync(
    new URL('../../../../sdk/testdata/ticket-vectors.json', import.meta.url),
    'utf8',
  ),
) as Vectors
const NOW = new Date(vectors.now * 1000)
const { secret } = vectors

describe('minting matches the shared vectors byte for byte', () => {
  const [upload, readObject, readChunk] = vectors.valid

  it('upload ticket', () => {
    const signed = signUploadTicket(
      secret,
      {
        namespace: upload!.claims.ns!,
        maxSizeBytes: BigInt(upload!.claims.max!),
      },
      NOW,
    )
    expect(signed.ticket).toBe(upload!.token)
    expect(signed.expiresAt.getTime() / 1000).toBe(
      vectors.now + UPLOAD_TICKET_TTL_SECONDS,
    )
  })

  it('read ticket for an object', () => {
    const signed = signReadTicket(
      secret,
      { objectId: readObject!.claims.obj! },
      NOW,
    )
    expect(signed.ticket).toBe(readObject!.token)
    expect(signed.expiresAt.getTime() / 1000).toBe(
      vectors.now + READ_TICKET_TTL_SECONDS,
    )
  })

  it('read ticket for a thumbnail chunk', () => {
    expect(
      signReadTicket(secret, { chunkSha256: readChunk!.claims.chk! }, NOW)
        .ticket,
    ).toBe(readChunk!.token)
  })
})

describe('verifying the shared vectors', () => {
  for (const v of vectors.valid) {
    it(`accepts ${v.name}`, () => {
      const claims = verifyTicket(secret, v.token, NOW)
      expect(claims.kind).toBe(v.claims.k)
      expect(claims.exp).toBe(v.claims.exp)
    })
  }
  for (const v of vectors.invalid) {
    it(`rejects ${v.name} as ${v.error}`, () => {
      try {
        verifyTicket(secret, v.token, NOW)
        expect.fail('accepted')
      } catch (err) {
        expect(err).toBeInstanceOf(TicketError)
        expect((err as TicketError).reason).toBe(v.error)
      }
    })
  }
})

describe('tickets', () => {
  it('keep sizes above 2^53 exact', () => {
    const max = 2n ** 60n + 1n
    const { ticket } = signUploadTicket(
      secret,
      { namespace: 2, maxSizeBytes: max },
      NOW,
    )
    expect(verifyTicket(secret, ticket, NOW)).toMatchObject({
      kind: 'up',
      namespace: 2,
      maxSizeBytes: max,
    })
  })

  it('expire after their lifetime plus 30 seconds of skew', () => {
    const { ticket } = signReadTicket(secret, { objectId: 'o' }, NOW)
    const later = (s: number) => new Date(NOW.getTime() + s * 1000)
    expect(() =>
      verifyTicket(secret, ticket, later(READ_TICKET_TTL_SECONDS + 30)),
    ).not.toThrow()
    expect(() =>
      verifyTicket(secret, ticket, later(READ_TICKET_TTL_SECONDS + 31)),
    ).toThrow(/expired/)
  })

  it('reject every one-byte change', () => {
    const { ticket } = signUploadTicket(
      secret,
      { namespace: 1, maxSizeBytes: 10n },
      NOW,
    )
    for (let i = 3; i < ticket.length; i++) {
      if (ticket[i] === '.') continue
      const changed =
        ticket.slice(0, i) +
        (ticket[i] === 'A' ? 'B' : 'A') +
        ticket.slice(i + 1)
      expect(() => verifyTicket(secret, changed, NOW), `byte ${i}`).toThrow(
        TicketError,
      )
    }
  })

  it('refuse to mint malformed scopes', () => {
    expect(() =>
      signUploadTicket(secret, { namespace: 0, maxSizeBytes: 1n }),
    ).toThrow()
    expect(() =>
      signUploadTicket(secret, { namespace: 1, maxSizeBytes: 0n }),
    ).toThrow()
    expect(() => signReadTicket(secret, { chunkSha256: 'ABC' })).toThrow()
  })
})
