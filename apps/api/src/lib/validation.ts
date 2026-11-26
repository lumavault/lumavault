// Input schemas and parsers shared by every RPC handler, so each field has one rule.
import { Code, ConnectError } from '@connectrpc/connect'
import { z } from 'zod'

export const emailSchema = z.email()
export const uuidSchema = z.uuid()

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
