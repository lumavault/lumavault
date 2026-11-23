// A stand-in media app for IAM tests, backed by a real table so its records commit and roll
// back with IAM's transactions. Never imported by the server.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "#/db/index.js";
import type { AppDataHooks } from "#/iam/app-data.js";
import type { IamApp } from "#/iam/constants.js";

export interface StandInItem {
  id: string;
  householdId: string;
  ownerId: string;
  shared: boolean;
  name: string;
  objectId: string;
}

/** Hooks that do nothing, for tests that only care about some of them. */
export function noopAppHooks(app: IamApp): AppDataHooks {
  return {
    app,
    privateObjects: async () => [],
    sharedItems: async () => [],
    copySharedItems: async () => {},
    movePrivateData: async () => {},
    deletePrivateData: async () => {},
    deleteHousehold: async () => {},
  };
}

export interface StandInApp {
  hooks: AppDataHooks;
  /** Adds one item backed by objectId. */
  add(item: Omit<StandInItem, "id">): Promise<string>;
  items(householdId: string): Promise<StandInItem[]>;
  /** Makes the next movePrivateData call throw, to test rollback. */
  failNextMove(): void;
}

/** Creates the stand-in app's table and returns its hooks. Each item has one object. */
export async function installStandInApp(db: Db, app: IamApp = "photos"): Promise<StandInApp> {
  await db.execute(sql`create table if not exists stand_in_items (
    id text primary key,
    household_id text not null,
    owner_id text not null,
    shared boolean not null,
    name text not null,
    object_id text not null
  )`);
  let failNext = false;

  const select = async (tx: DbOrTx, where: ReturnType<typeof sql>): Promise<StandInItem[]> => {
    const res = await tx.execute(
      sql`select id, household_id as "householdId", owner_id as "ownerId", shared, name, object_id as "objectId" from stand_in_items where ${where} order by id`,
    );
    return res.rows as unknown as StandInItem[];
  };

  const hooks: AppDataHooks = {
    app,
    async privateObjects(tx, userId, householdId) {
      const rows = await select(tx, sql`household_id = ${householdId} and owner_id = ${userId} and not shared`);
      return rows.map((r) => r.objectId);
    },
    async sharedItems(tx, householdId) {
      const rows = await select(tx, sql`household_id = ${householdId} and shared`);
      return rows.map((r) => ({ kind: "item", id: r.id, name: r.name, uploadedBy: r.ownerId, objectIds: [r.objectId] }));
    },
    async copySharedItems(tx, items, toHouseholdId, userId, copies) {
      for (const item of items) {
        const objectId = copies.get(item.objectIds[0]!)!;
        await tx.execute(
          sql`insert into stand_in_items values (${randomUUID()}, ${toHouseholdId}, ${userId}, true, ${item.name}, ${objectId})`,
        );
      }
    },
    async movePrivateData(tx, userId, fromHouseholdId, toHouseholdId) {
      if (failNext) {
        failNext = false;
        throw new Error("stand-in app failed to move");
      }
      await tx.execute(
        sql`update stand_in_items set household_id = ${toHouseholdId} where household_id = ${fromHouseholdId} and owner_id = ${userId} and not shared`,
      );
    },
    async deletePrivateData(tx, userId, householdId) {
      await tx.execute(sql`delete from stand_in_items where household_id = ${householdId} and owner_id = ${userId} and not shared`);
    },
    async deleteHousehold(tx, householdId) {
      await tx.execute(sql`delete from stand_in_items where household_id = ${householdId}`);
    },
  };

  return {
    hooks,
    async add(item) {
      const id = randomUUID();
      await db.execute(
        sql`insert into stand_in_items values (${id}, ${item.householdId}, ${item.ownerId}, ${item.shared}, ${item.name}, ${item.objectId})`,
      );
      return id;
    },
    items: (householdId) => select(db, sql`household_id = ${householdId}`),
    failNextMove() {
      failNext = true;
    },
  };
}
