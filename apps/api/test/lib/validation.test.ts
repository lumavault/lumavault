import { randomUUID } from 'node:crypto'
import { Code, ConnectError } from '@connectrpc/connect'
import { parseInput, requiredUuidSchema } from '#/lib/validation.js'
import { describe, expect, it } from 'vitest'

describe('lib/validation', () => {
  it('trims and validates required UUID fields', () => {
    const schema = requiredUuidSchema('movie_id')
    const id = randomUUID()
    expect(parseInput(schema, `  ${id}  `)).toBe(id)

    for (const [value, expected] of [
      ['', 'movie_id is required'],
      ['   ', 'movie_id is required'],
      ['not-a-uuid', 'movie_id is not a valid ID'],
    ] as const) {
      try {
        parseInput(schema, value)
        expect.unreachable()
      } catch (err) {
        const ce = ConnectError.from(err)
        expect(ce.code).toBe(Code.InvalidArgument)
        expect(ce.rawMessage).toBe(expected)
      }
    }
  })
})
