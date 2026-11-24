import {
  HOUSEHOLD_ROLES,
  type HouseholdRole,
  type UserRole,
} from './constants.js'

export function isHouseholdRole(role: string): role is HouseholdRole {
  return (HOUSEHOLD_ROLES as readonly string[]).includes(role)
}

// The admin plugin stores a user's roles as one comma-separated string.
export function hasUserRole(
  roles: string | null | undefined,
  role: UserRole,
): boolean {
  return (roles ?? '').split(',').some((r) => r.trim() === role)
}
