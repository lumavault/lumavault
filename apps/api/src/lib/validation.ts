// Input schemas and parsers shared by every RPC handler, so each field has one rule.
import { Code, ConnectError } from '@connectrpc/connect'
import { MAX_PG_BIGINT, MAX_PG_INT } from '#/db/constants.js'
import { z } from 'zod'

export const emailSchema = z.email()
export const uuidSchema = z.uuid()
export const nonNegativeBigintSchema = z.bigint().min(0n).max(MAX_PG_BIGINT)

/** Schema for a required, trimmed UUID string field. */
export function requiredUuidSchema(field: string) {
  return z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .refine(
      (value) => uuidSchema.safeParse(value).success,
      `${field} is not a valid ID`,
    )
}

/** Schema for a required, trimmed Storage Gateway object ID without path separators. */
export function requiredObjectIdSchema(field = 'object_id') {
  return z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .refine(
      (value) => value !== '.' && value !== '..' && !/[/\\]/.test(value),
      `${field} is not valid`,
    )
}

/** Schema for a positive signed 32-bit Postgres integer field. */
export function positiveIntSchema(field: string) {
  return z
    .number({ error: `${field} must be a whole number` })
    .int(`${field} must be a whole number`)
    .min(1, `${field} must be positive`)
    .max(MAX_PG_INT, `${field} must be at most ${MAX_PG_INT}`)
}

/** Schema for a non-negative signed 32-bit Postgres integer field. */
export function nonNegativeIntSchema(field: string) {
  return z
    .number({ error: `${field} must be a whole number` })
    .int(`${field} must be a whole number`)
    .min(0, `${field} must be non-negative`)
    .max(MAX_PG_INT, `${field} must be at most ${MAX_PG_INT}`)
}

/** Parses value with schema or throws an InvalidArgument ConnectError. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message?: string,
): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const detail = result.error.issues[0]?.message ?? 'invalid argument'
    throw new ConnectError(message ?? detail, Code.InvalidArgument)
  }
  return result.data
}

/** Parses a non-negative Postgres bigint field, throwing InvalidArgument when out of range. */
export function parseNonNegativeBigint(value: bigint, field: string): bigint {
  return parseInput(
    nonNegativeBigintSchema,
    value,
    `${field} must be between 0 and ${MAX_PG_BIGINT}`,
  )
}
