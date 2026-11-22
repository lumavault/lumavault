import { Code, ConnectError } from "@connectrpc/connect";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { HOUSEHOLD_OWNER_ROLE, SUPER_ADMIN_ROLE } from "#/auth/constants.js";
import { createCredentialAccount } from "#/data/auth/account/create-account.js";
import { createMember } from "#/data/auth/member/create-member.js";
import { createOrganization } from "#/data/auth/organization/create-organization.js";
import { createUser } from "#/data/auth/user/create-user.js";
import { createHousehold } from "#/data/iam/household/create-household.js";
import { createInstanceSettingsIfMissing } from "#/data/iam/instance-settings/create-instance-settings.js";
import { getInstanceSettings, getInstanceSettingsForUpdate } from "#/data/iam/instance-settings/get-instance-settings.js";
import { markSetupCompleted } from "#/data/iam/instance-settings/update-instance-settings.js";
import { DEFAULT_MEMBER_LIMIT, IAM_APPS, SETUP_STORAGE_CAP_BYTES } from "#/iam/constants.js";
import { emailSchema } from "#/lib/validation.js";
import type { ApiModule, ModuleContext } from "#/server/modules.js";
import { householdToWire, required, userToWire } from "./convert.js";

async function checkPassword(ctx: ModuleContext, password: string): Promise<string> {
  const { config } = (await ctx.auth.$context).password;
  if (password.length < config.minPasswordLength || password.length > config.maxPasswordLength) {
    throw new ConnectError(
      `password must be ${config.minPasswordLength} to ${config.maxPasswordLength} characters`,
      Code.InvalidArgument,
    );
  }
  return password;
}

export const module: ApiModule = {
  name: "iam-setup",
  rpc(router, ctx) {
    router.rpc(IamService.method.getSetupStatus, async () => {
      const settings = await getInstanceSettings(ctx.db);
      return { needsSetup: !settings?.setupCompletedAt, adminEmailRequired: Boolean(ctx.config.adminEmail) };
    });

    router.rpc(IamService.method.completeSetup, async (req, call) => {
      const name = required(req.name, "name");
      const householdName = required(req.householdName, "household_name");
      const email = required(req.email, "email").toLowerCase();
      if (!emailSchema.safeParse(email).success) {
        throw new ConnectError("email is not a valid address", Code.InvalidArgument);
      }
      if (ctx.config.adminEmail && email !== ctx.config.adminEmail) {
        throw new ConnectError("this server is set up for a different admin email", Code.PermissionDenied);
      }
      const password = await checkPassword(ctx, req.password);
      // Hashing is slow on purpose, so it runs before the lock is taken.
      const passwordHash = await (await ctx.auth.$context).password.hash(password);

      // Everything is written here rather than through Better Auth's API, which commits on its
      // own connections, so a failure partway leaves nothing behind. The settings row lock
      // queues parallel calls, and every call after the first sees setup closed.
      const created = await ctx.db.transaction(async (tx) => {
        await createInstanceSettingsIfMissing(tx);
        const settings = await getInstanceSettingsForUpdate(tx);
        if (settings?.setupCompletedAt) {
          throw new ConnectError("this server is already set up", Code.FailedPrecondition);
        }
        const now = new Date();
        const admin = await createUser(tx, { name, email, role: SUPER_ADMIN_ROLE, emailVerified: true });
        await createCredentialAccount(tx, { userId: admin.id, passwordHash });
        const org = await createOrganization(tx, { name: householdName, createdAt: now });
        await createMember(tx, { organizationId: org.id, userId: admin.id, role: HOUSEHOLD_OWNER_ROLE, createdAt: now });
        const household = await createHousehold(tx, {
          householdId: org.id,
          storageCapBytes: SETUP_STORAGE_CAP_BYTES,
          enabledApps: [...IAM_APPS],
          memberLimit: DEFAULT_MEMBER_LIMIT,
        });
        await markSetupCompleted(tx, now);
        return { admin, org, household };
      });

      // Sign the browser in. Setup is already done, so if this fails the admin signs in normally.
      try {
        const signIn = await ctx.auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
        for (const cookie of signIn.headers.getSetCookie()) {
          call.responseHeader.append("set-cookie", cookie);
        }
      } catch (err) {
        console.error("setup finished but signing the admin in failed", err);
      }

      return {
        user: userToWire(created.admin),
        household: householdToWire(created.org, created.household, created.admin.id),
      };
    });
  },
};
