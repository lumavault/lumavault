// Admin plugin roles on the user. "admin" is the Super-Admin flag; everyone else is "user".
export const SUPER_ADMIN_ROLE = 'admin'
export const DEFAULT_USER_ROLE = 'user'
export const USER_ROLES = [SUPER_ADMIN_ROLE, DEFAULT_USER_ROLE] as const
export type UserRole = (typeof USER_ROLES)[number]

// Household roles, stored on Better Auth organization members. Each household has exactly one
// owner, who created it or was handed it, and who has every admin power.
export const HOUSEHOLD_OWNER_ROLE = 'owner'
export const HOUSEHOLD_ADMIN_ROLE = 'admin'
export const HOUSEHOLD_MEMBER_ROLE = 'member'
export const HOUSEHOLD_ROLES = [
  HOUSEHOLD_OWNER_ROLE,
  HOUSEHOLD_ADMIN_ROLE,
  HOUSEHOLD_MEMBER_ROLE,
] as const
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number]

// Better Auth stores email and password sign-in as an account with this provider ID.
export const CREDENTIAL_PROVIDER_ID = 'credential'

// Household organizations get a random slug with this prefix. Slugs are never shown.
export const HOUSEHOLD_SLUG_PREFIX = 'household-'

export const PASSKEY_RP_NAME = 'LumaVault'

// Storage tickets: the format is fixed by the storage tickets scoping doc and checked against
// sdk/testdata/ticket-vectors.json, which the Go Gateway also passes.
export const TICKET_PREFIX = 'v1.'
export const UPLOAD_TICKET_TTL_SECONDS = 24 * 60 * 60
export const READ_TICKET_TTL_SECONDS = 6 * 60 * 60
export const TICKET_CLOCK_SKEW_SECONDS = 30
