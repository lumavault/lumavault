// Input schemas and parsers shared by every RPC handler, so each field has one rule.
import { Code, ConnectError } from '@connectrpc/connect'
import { MAX_PG_BIGINT } from '#/db/constants.js'
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
