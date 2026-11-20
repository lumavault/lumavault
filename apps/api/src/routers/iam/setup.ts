import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { type CreatedAdmin, createFirstAdmin, createHouseholdFor } from "#/auth/server-helpers.js";
import { deleteUser } from "#/data/auth/user/delete-user.js";
import { getSuperAdmin, getUserById } from "#/data/auth/user/get-user.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { createInstanceSettingsIfMissing } from "#/data/iam/instance-settings/create-instance-settings.js";
import { getInstanceSettings, getInstanceSettingsForUpdate } from "#/data/iam/instance-settings/get-instance-settings.js";
import { markSetupCompleted } from "#/data/iam/instance-settings/update-instance-settings.js";
import type { DbOrTx } from "#/db/index.js";
import { IAM_APPS, SETUP_STORAGE_CAP_BYTES } from "#/iam/constants.js";
import type { ApiModule } from "#/modules.js";
import { required } from "./convert.js";
import { loadHousehold } from "./household-queries.js";
import { userMessage } from "./messages.js";

async function setupDone(db: DbOrTx): Promise<boolean> {
  const settings = await getInstanceSettings(db);
  if (settings?.setupCompletedAt) {
    return true;
  }
  return Boolean(await getSuperAdmin(db));
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
        await createInstanceSettingsIfMissing(tx);
        await getInstanceSettingsForUpdate(tx);
        if (await setupDone(tx)) {
          throw new ConnectError("this server is already set up", Code.FailedPrecondition);
        }
        let admin: CreatedAdmin | undefined;
        try {
          admin = await createFirstAdmin(ctx, account);
          const household = await createHouseholdFor(ctx, admin.userId, householdName);
          await createHousehold(tx, {
            householdId: household.id,
            storageCapBytes: SETUP_STORAGE_CAP_BYTES,
            enabledApps: [...IAM_APPS],
          });
          await markSetupCompleted(tx);
          return { admin, householdId: household.id };
        } catch (err) {
          if (admin) {
            await deleteUser(ctx.db, admin.userId);
          }
          throw err;
        }
      });

      // Sign the browser in as the new owner.
      for (const cookie of done.admin.setCookie) {
        call.responseHeader.append("set-cookie", cookie);
      }
      const u = await getUserById(ctx.db, done.admin.userId);
      const household = await loadHousehold(ctx.db, done.householdId);
      return { user: userMessage(u!), household: household?.message };
    });
  },
};
