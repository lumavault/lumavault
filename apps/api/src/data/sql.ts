import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** A bigint parameter. node-postgres cannot send BigInt values itself. */
export function big(value: bigint): SQL {
  return sql`${value.toString()}::bigint`;
}

/** column + value. */
export function plus(column: AnyPgColumn, value: bigint): SQL {
  return sql`${column} + ${big(value)}`;
}

/** column - value, never below zero, so a refund after a cap change can never fail a check. */
export function minusFloor(column: AnyPgColumn, value: bigint): SQL {
  return sql`greatest(${column} - ${big(value)}, 0)`;
}
