import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "#/db/index.js";

/** The transaction handle Drizzle passes to db.transaction callbacks. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
