import { SHA256_HEX } from '#/constants.js'
import {
  DEFAULT_MEMBER_LIMIT,
  IAM_APPS,
  INSTANCE_SETTINGS_ID,
  type IamApp,
} from '#/iam/constants.js'
import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core'

import { organization, user } from './auth.js'
import { iamSchema } from './namespaces.js'

// Every table in the iam Postgres schema: household allowances and storage accounting,
// invites, upload reservations and claims, and Apple TV pairing.

// Enums

export const iamApp = iamSchema.enum('app', IAM_APPS)

export const uploadReservationStatus = iamSchema.enum(
  'upload_reservation_status',
  ['pending', 'finished', 'cancelled', 'expired'],
)

export const pairingStatus = iamSchema.enum('pairing_status', [
  'pending',
  'approved',
  'claimed',
  'expired',
])

// Households

// Enabled apps are a text array checked against the app list. drizzle-kit keeps re-altering
// enum arrays and array defaults, so tables use a plain array with this check and a
// default set in code.
function enabledAppsCheck(table: string, column: PgColumn) {
  const allowed: SQL = sql.raw(
    `array[${IAM_APPS.map((a) => `'${a}'`).join(', ')}]::text[]`,
  )
  return check(`${table}_enabled_apps_known`, sql`${column} <@ ${allowed}`)
}

// One row per Better Auth organization: the allowance the Super-Admin grants, and the
// household's storage accounting. Reserved bytes belong to uploads not yet finished.
export const iamHouseholds = iamSchema.table(
  'households',
  {
    householdId: text('household_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    storageCapBytes: bigint('storage_cap_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`'0'`),
    enabledApps: text('enabled_apps')
      .array()
      .$type<IamApp[]>()
      .notNull()
      .$defaultFn(() => []),
    memberLimit: integer('member_limit')
      .notNull()
      .default(DEFAULT_MEMBER_LIMIT),
    usedBytes: bigint('used_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`'0'`),
    reservedBytes: bigint('reserved_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`'0'`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    enabledAppsCheck('households', t.enabledApps),
    check(
      'households_storage_cap_bytes_nonnegative',
      sql`${t.storageCapBytes} >= 0`,
    ),
    check('households_used_bytes_nonnegative', sql`${t.usedBytes} >= 0`),
    check(
      'households_reserved_bytes_nonnegative',
      sql`${t.reservedBytes} >= 0`,
    ),
    check('households_member_limit_positive', sql`${t.memberLimit} >= 1`),
  ],
)

// Exactly one row. First-run setup locks it, so two parallel setup calls cannot both create
// a Super-Admin.
export const iamInstanceSettings = iamSchema.table(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(INSTANCE_SETTINGS_ID),
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'instance_settings_single_row',
      sql`${t.id} = ${sql.raw(String(INSTANCE_SETTINGS_ID))}`,
    ),
  ],
)

// Invites

// Single-use links from the Super-Admin that let one email address create a household with a
// preset allowance. Only the SHA-256 of the link's secret is stored.
export const iamHouseholdInvites = iamSchema.table(
  'household_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    // Stored lowercased; only this address can use the invite.
    email: text('email').notNull(),
    storageCapBytes: bigint('storage_cap_bytes', { mode: 'bigint' }).notNull(),
    enabledApps: text('enabled_apps')
      .array()
      .$type<IamApp[]>()
      .notNull()
      .$defaultFn(() => []),
    memberLimit: integer('member_limit')
      .notNull()
      .default(DEFAULT_MEMBER_LIMIT),
    note: text('note').notNull().default(''),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    redeemedBy: text('redeemed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    householdId: text('household_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    enabledAppsCheck('household_invites', t.enabledApps),
    check(
      'household_invites_token_hash_is_sha256',
      sql`${t.tokenHash} ~ ${sql.raw(`'${SHA256_HEX.source}'`)}`,
    ),
    check(
      'household_invites_storage_cap_bytes_nonnegative',
      sql`${t.storageCapBytes} >= 0`,
    ),
    check(
      'household_invites_member_limit_positive',
      sql`${t.memberLimit} >= 1`,
    ),
    index('household_invites_email_idx').on(t.email),
  ],
)

// Uploads

// Bytes held against a household's cap while an upload is in flight. A null household means
// the instance-wide shared library, which bills no household.
export const iamUploadReservations = iamSchema.table(
  'upload_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: text('household_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    app: iamApp('app').notNull(),
    bytes: bigint('bytes', { mode: 'bigint' }).notNull(),
    status: uploadReservationStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    check('upload_reservations_bytes_positive', sql`${t.bytes} > 0`),
    index('upload_reservations_pending_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
  ],
)

// Records which household paid for each stored Gateway object and who uploaded it. The object
// ID is the primary key, so an object can be claimed only once. releasedAt marks the one-time
// refund on delete.
export const iamObjectClaims = iamSchema.table(
  'object_claims',
  {
    objectId: text('object_id').primaryKey(),
    householdId: text('household_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    // Null for objects whose uploader has since deleted their account.
    uploadedBy: text('uploaded_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    reservationId: uuid('reservation_id')
      .unique()
      .references(() => iamUploadReservations.id, { onDelete: 'set null' }),
    app: iamApp('app').notNull(),
    bytes: bigint('bytes', { mode: 'bigint' }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    check('object_claims_bytes_nonnegative', sql`${t.bytes} >= 0`),
    index('object_claims_household_uploader_idx').on(
      t.householdId,
      t.uploadedBy,
    ),
  ],
)

// Apple TV pairing

// Apple TV sign-in by short code. The Apple TV keeps the device secret; only its SHA-256 is
// stored. The bearer session is minted when the Apple TV claims an approved request, so no
// session token is ever stored here.
export const iamPairingRequests = iamSchema.table(
  'pairing_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    deviceSecretHash: text('device_secret_hash').notNull(),
    deviceName: text('device_name').notNull(),
    status: pairingStatus('status').notNull().default('pending'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    requesterIp: text('requester_ip').notNull(),
    approvedBy: text('approved_by').references(() => user.id, {
      onDelete: 'cascade',
    }),
    householdId: text('household_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'pairing_requests_device_secret_hash_is_sha256',
      sql`${t.deviceSecretHash} ~ ${sql.raw(`'${SHA256_HEX.source}'`)}`,
    ),
    check(
      'pairing_requests_failed_attempts_nonnegative',
      sql`${t.failedAttempts} >= 0`,
    ),
    uniqueIndex('pairing_requests_pending_code_unique')
      .on(t.code)
      .where(sql`${t.status} = 'pending'`),
    index('pairing_requests_requester_ip_idx').on(t.requesterIp, t.createdAt),
  ],
)
