import { hasUserRole, isHouseholdRole } from '#/auth/role-checks.js'
import { describe, expect, it } from 'vitest'

describe('isHouseholdRole', () => {
  it('accepts only the three household roles', () => {
    expect(['owner', 'admin', 'member'].every(isHouseholdRole)).toBe(true)
    expect(isHouseholdRole('superuser')).toBe(false)
    expect(isHouseholdRole('')).toBe(false)
    expect(isHouseholdRole('Owner')).toBe(false)
  })
})

describe('hasUserRole', () => {
  it('finds a role in the comma-separated list the admin plugin stores', () => {
    expect(hasUserRole('admin', 'admin')).toBe(true)
    expect(hasUserRole('user, admin', 'admin')).toBe(true)
    expect(hasUserRole('user', 'admin')).toBe(false)
  })

  it('does not match part of another role', () => {
    expect(hasUserRole('administrator', 'admin')).toBe(false)
  })

  it('treats a missing role as none', () => {
    expect(hasUserRole(null, 'admin')).toBe(false)
    expect(hasUserRole(undefined, 'user')).toBe(false)
  })
})
