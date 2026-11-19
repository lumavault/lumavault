// Postgres error codes the API reacts to. node-postgres errors arrive as the cause of a
// Drizzle error.
const INVALID_TEXT_REPRESENTATION = "22P02";
const UNIQUE_VIOLATION = "23505";
const OBJECT_IN_USE = "55006";

export function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION;
}

/** Postgres refuses to copy a template database while another session is using it. */
export function isObjectInUse(err: unknown): boolean {
  return pgErrorCode(err) === OBJECT_IN_USE;
}

/** For a lookup by an ID column of type uuid: a malformed ID finds nothing instead of failing. */
export function noRowsOnBadUuid(err: unknown): never[] {
  if (pgErrorCode(err) === INVALID_TEXT_REPRESENTATION) {
    return [];
  }
  throw err;
}
