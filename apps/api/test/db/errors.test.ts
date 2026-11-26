import {
  isForeignKeyViolation,
  isUniqueViolation,
  pgErrorCode,
  pgErrorConstraint,
} from '#/db/errors.js'
import { describe, expect, it } from 'vitest'

describe('db/errors', () => {
  it('reads Postgres error codes and constraint names from direct and wrapped errors', () => {
    const direct = { code: '23503', constraint: 'my_fk' }
    const wrapped = { cause: { code: '23505', constraint: 'my_unique' } }

    expect(pgErrorCode(direct)).toBe('23503')
    expect(pgErrorConstraint(direct)).toBe('my_fk')
    expect(pgErrorCode(wrapped)).toBe('23505')
    expect(pgErrorConstraint(wrapped)).toBe('my_unique')
    expect(isUniqueViolation(wrapped)).toBe(true)
    expect(isUniqueViolation(direct)).toBe(false)
  })

  it('matches foreign key violations globally or by constraint name', () => {
    const allowed = new Set(['target_fk'])
    const matching = { cause: { code: '23503', constraint: 'target_fk' } }
    const otherFk = { cause: { code: '23503', constraint: 'user_fk' } }
    const noConstraint = { cause: { code: '23503' } }
    const uniqueErr = { cause: { code: '23505', constraint: 'target_fk' } }

    expect(isForeignKeyViolation(matching)).toBe(true)
    expect(isForeignKeyViolation(otherFk)).toBe(true)
    expect(isForeignKeyViolation(matching, allowed)).toBe(true)
    expect(isForeignKeyViolation(otherFk, allowed)).toBe(false)
    expect(isForeignKeyViolation(noConstraint, allowed)).toBe(false)
    expect(isForeignKeyViolation(uniqueErr, allowed)).toBe(false)
  })
})
