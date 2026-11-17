import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { eq, sql } from "drizzle-orm";
import { SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { type CreatedAdmin, createFirstAdmin, createHouseholdFor } from "#/auth/server-helpers.js";
import type { Db } from "#/db/index.js";
import { organization, session, user } from "#/db/schemas/auth.js";
import { iamHouseholds, iamInstanceSettings } from "#/db/schemas/iam.js";
import { IAM_APPS, INSTANCE_SETTINGS_ID, SETUP_STORAGE_CAP_BYTES } from "#/iam/constants.js";
import type { ApiModule } from "#/modules.js";
import { required } from "./convert.js";
import { householdMessage, userMessage } from "./messages.js";

async function setupDone(db: Pick<Db, "select">): Promise<boolean> {
  const [settings] = await db.select().from(iamInstanceSettings).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID));
  if (settings?.setupCompletedAt) {
    return true;
  }
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`string_to_array(coalesce(${user.role}, ''), ',') @> array[${SUPER_ADMIN_ROLE}]`)
    .limit(1);
  return Boolean(admin);
}

export const module: ApiModule = {
  name: "iam-setup",
  rpc(router, ctx) {
    router.rpc(IamService.method.getSetupStatus, async () => ({
      needsSetup: !(await setupDone(ctx.db)),
      adminEmailRequired: Boolean(ctx.config.adminEmail),
    }));

    router.rpc(IamService.method.completeSetup, async (req, call) => {
      const account = {
        name: required(req.name, "name"),
        email: required(req.email, "email").toLowerCase(),
        password: req.password,
      };
      const householdName = required(req.householdName, "household_name");
      if (ctx.config.adminEmail && account.email !== ctx.config.adminEmail) {
        throw new ConnectError("this server is set up for a different admin email", Code.PermissionDenied);
      }

      // The settings row lock makes parallel setup calls run one at a time; every call after
      // the first sees setup done and stops. Better Auth writes on its own connections, so a
      // failure partway removes the new account by hand.
      const done = await ctx.db.transaction(async (tx) => {
        await tx.insert(iamInstanceSettings).values({ id: INSTANCE_SETTINGS_ID }).onConflictDoNothing();
        await tx.select().from(iamInstanceSettings).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID)).for("update");
        if (await setupDone(tx)) {
          throw new ConnectError("this server is already set up", Code.FailedPrecondition);
        }
        let admin: CreatedAdmin | undefined;
        try {
          admin = await createFirstAdmin(ctx, account);
          const household = await createHouseholdFor(ctx, admin.userId, householdName);
          await tx.insert(iamHouseholds).values({
            householdId: household.id,
            storageCapBytes: SETUP_STORAGE_CAP_BYTES,
            enabledApps: [...IAM_APPS],
          });
          await tx.update(iamInstanceSettings).set({ setupCompletedAt: new Date() }).where(eq(iamInstanceSettings.id, INSTANCE_SETTINGS_ID));
          return { admin, householdId: household.id };
        } catch (err) {
          if (admin) {
            await ctx.db.delete(user).where(eq(user.id, admin.userId));
          }
          throw err;
        }
      });

      // Open the new session in the new household, then sign the browser in.
      await ctx.db.update(session).set({ activeOrganizationId: done.householdId }).where(eq(session.token, done.admin.token));
      for (const cookie of done.admin.setCookie) {
        call.responseHeader.append("set-cookie", cookie);
      }
      const [u] = await ctx.db.select().from(user).where(eq(user.id, done.admin.userId));
      const [org] = await ctx.db.select().from(organization).where(eq(organization.id, done.householdId));
      const [h] = await ctx.db.select().from(iamHouseholds).where(eq(iamHouseholds.householdId, done.householdId));
      return { user: userMessage(u!), household: householdMessage(org!, h) };
    });
  },
};
