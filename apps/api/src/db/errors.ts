// Postgres error codes the API reacts to. node-postgres errors arrive as the cause of a
// Drizzle error.
const INVALID_TEXT_REPRESENTATION = '22P02'
const FOREIGN_KEY_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'

export function pgErrorCode(err: unknown): string | undefined {
  return (
    (err as { cause?: { code?: string } }).cause?.code ??
    (err as { code?: string }).code
  )
}

export function pgErrorConstraint(err: unknown): string | undefined {
  return (
    (err as { cause?: { constraint?: string } }).cause?.constraint ??
    (err as { constraint?: string }).constraint
  )
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION
}

/** True when err is a Postgres foreign key violation, optionally scoped to specific constraints. */
export function isForeignKeyViolation(
  err: unknown,
  constraints?: ReadonlySet<string>,
): boolean {
  if (pgErrorCode(err) !== FOREIGN_KEY_VIOLATION) {
    return false
  }
  if (!constraints) {
    return true
  }
  const constraint = pgErrorConstraint(err)
  return constraint !== undefined && constraints.has(constraint)
}

/** For a lookup by an ID column of type uuid: a malformed ID finds nothing instead of failing. */
export function noRowsOnBadUuid(err: unknown): never[] {
  if (pgErrorCode(err) === INVALID_TEXT_REPRESENTATION) {
    return []
  }
  throw err
}
