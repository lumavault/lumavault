import { randomUUID } from 'node:crypto'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  parseInput,
  requiredObjectIdSchema,
  requiredUuidSchema,
  uuidSchema,
} from '#/lib/validation.js'
import { describe, expect, it } from 'vitest'

describe('lib/validation', () => {
  it('trims and validates required UUID fields', () => {
    const schema = requiredUuidSchema('reservation_id')
    const id = randomUUID()
    expect(parseInput(schema, `  ${id}  `)).toBe(id)

    for (const [value, expected] of [
      ['', 'reservation_id is required'],
      ['   ', 'reservation_id is required'],
      ['not-a-uuid', 'reservation_id is not a valid ID'],
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

  it('trims and validates required Storage Gateway object IDs', () => {
    const schema = requiredObjectIdSchema('object_id')
    expect(parseInput(schema, '  obj-123  ')).toBe('obj-123')

    for (const [value, expected] of [
      ['', 'object_id is required'],
      ['   ', 'object_id is required'],
      ['.', 'object_id is not valid'],
      ['..', 'object_id is not valid'],
      ['../escape', 'object_id is not valid'],
      ['dir/file', 'object_id is not valid'],
      ['dir\\file', 'object_id is not valid'],
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

  it('allows overriding the ConnectError message in parseInput', () => {
    try {
      parseInput(uuidSchema, 'bad-cursor-id', 'page_token is not valid')
      expect.unreachable()
    } catch (err) {
      const ce = ConnectError.from(err)
      expect(ce.code).toBe(Code.InvalidArgument)
      expect(ce.rawMessage).toBe('page_token is not valid')
    }
  })
})
