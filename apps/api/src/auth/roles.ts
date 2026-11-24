import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

import {
  HOUSEHOLD_ADMIN_ROLE,
  HOUSEHOLD_MEMBER_ROLE,
  HOUSEHOLD_OWNER_ROLE,
} from './constants.js'

// Households have three roles, matching Better Auth's own: owner, admin, and member.
// IamService enforces the household rules on top of these, such as one owner per household.
export const householdAccess = createAccessControl(defaultStatements)

export const householdRoles = {
  [HOUSEHOLD_OWNER_ROLE]: householdAccess.newRole(ownerAc.statements),
  [HOUSEHOLD_ADMIN_ROLE]: householdAccess.newRole(adminAc.statements),
  [HOUSEHOLD_MEMBER_ROLE]: householdAccess.newRole(memberAc.statements),
}
