import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import type { LumaVaultAuthClient } from "./client.js";
import { INVITE_TOKEN_HEADER } from "./constants.js";
import { type AuthErrorLike, authErrorMessage } from "./errors.js";
import type {
  ChangePasswordValues,
  ForgotPasswordValues,
  MagicLinkValues,
  ResetPasswordValues,
  SignInValues,
  SignUpValues,
} from "./schemas.js";

const AuthClientContext = createContext<LumaVaultAuthClient | null>(null);

/** Makes one Better Auth client available to the auth hooks. */
export function AuthProvider({ client, children }: { client: LumaVaultAuthClient; children: ReactNode }) {
  return <AuthClientContext.Provider value={client}>{children}</AuthClientContext.Provider>;
}

export function useAuthClient(): LumaVaultAuthClient {
  const client = useContext(AuthClientContext);
  if (!client) {
    throw new Error("wrap the app in AuthProvider to use the auth hooks");
  }
  return client;
}

/** What Better Auth's client calls resolve to. */
interface AuthResult {
  error?: AuthErrorLike | null;
}

export interface AuthAction<Args extends unknown[]> {
  /** Runs the call. Resolves true on success; on failure, error holds a plain message. */
  run: (...args: Args) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

function useAuthAction<Args extends unknown[]>(
  call: (client: LumaVaultAuthClient, ...args: Args) => Promise<AuthResult>,
): AuthAction<Args> {
  const client = useAuthClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: Args) => {
      setLoading(true);
      setError(null);
      try {
        const result = await call(client, ...args);
        const message = authErrorMessage(result?.error);
        setError(message);
        return message === null;
      } catch {
        setError(authErrorMessage({}));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [client, call],
  );
  return { run, loading, error };
}

export const useSignIn = () => useAuthAction((c, v: SignInValues) => c.signIn.email(v));

/** Sign-up, with the household invite token when it comes from an invite link. */
export const useSignUp = (inviteToken?: string) =>
  useAuthAction((c, v: SignUpValues) =>
    c.signUp.email(
      { name: v.name, email: v.email, password: v.password },
      inviteToken ? { headers: { [INVITE_TOKEN_HEADER]: inviteToken } } : undefined,
    ),
  );

export const useMagicLink = () =>
  useAuthAction((c, v: MagicLinkValues, callbackURL: string) => c.signIn.magicLink({ email: v.email, callbackURL }));

export const usePasskeySignIn = () => useAuthAction((c) => c.signIn.passkey());

export const useAddPasskey = () => useAuthAction((c, name: string) => c.passkey.addPasskey({ name }));

export const useForgotPassword = () =>
  useAuthAction((c, v: ForgotPasswordValues, redirectTo: string) => c.requestPasswordReset({ email: v.email, redirectTo }));

export const useResetPassword = () =>
  useAuthAction((c, v: ResetPasswordValues, token: string) => c.resetPassword({ newPassword: v.newPassword, token }));

export const useChangePassword = () =>
  useAuthAction((c, v: ChangePasswordValues) =>
    c.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword, revokeOtherSessions: true }),
  );

export const useSignOut = () => useAuthAction((c) => c.signOut());

/** The signed-in user from Better Auth's session, or null when signed out. */
export function useCurrentUser() {
  const session = useAuthClient().useSession();
  return { user: session.data?.user ?? null, loading: session.isPending, error: session.error ? authErrorMessage(session.error) : null };
}
