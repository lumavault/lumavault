import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/** A bigint parameter. node-postgres cannot send BigInt values itself. */
export function big(value: bigint): SQL {
  return sql`${value.toString()}::bigint`
}

/** A text parameter cast to uuid, for IDs that come from clients. Pair with noRowsOnBadUuid. */
export function uuid(value: string): SQL {
  return sql`${value}::uuid`
}

/** A LIKE pattern matching text that contains value, with its wildcards taken literally. */
export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** column + value. */
export function plus(column: AnyPgColumn, value: bigint): SQL {
  return sql`${column} + ${big(value)}`
}

/** column - value, never below zero, so a refund after a cap change can never fail a check. */
export function minusFloor(column: AnyPgColumn, value: bigint): SQL {
  return sql`greatest(${column} - ${big(value)}, 0)`
}

/** Where a keyset page starts: the sort key of the last row on the previous page. */
export interface PageCursor {
  createdAt: Date
  id: string
}

// Postgres keeps microseconds but a JS Date only milliseconds, so pages sort and compare on
// created_at truncated to milliseconds. That way a cursor round-trips exactly.
function createdAtMs(column: AnyPgColumn): SQL {
  return sql`date_trunc('milliseconds', ${column})`
}

/** Orders rows by creation time, then ID, the order every keyset page uses. */
export function keysetOrder(createdAt: AnyPgColumn, id: AnyPgColumn): SQL[] {
  return [createdAtMs(createdAt), sql`${id}`]
}

/**
 * Rows that sort after the cursor in keysetOrder. For timestamp columns without a time zone,
 * like Better Auth's, which Drizzle fills with UTC wall-clock time.
 */
export function keysetAfter(
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
  cursor: PageCursor,
): SQL {
  const utc = cursor.createdAt.toISOString().replace('Z', '')
  return sql`(${createdAtMs(createdAt)}, ${id}) > (${utc}::timestamp, ${cursor.id})`
}
