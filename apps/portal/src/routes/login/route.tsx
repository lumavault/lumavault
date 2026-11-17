import { useQuery } from "@connectrpc/connect-query";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { RETURN_TO_PARAM } from "@lumavault/ui";
import { createRoute, Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { ForgotPasswordForm, ResetPasswordForm } from "@/components/auth/password-forms";
import { FieldSeparator } from "@/components/ui/field";
import { publicRoute } from "@/layout/routes";

const returnToSearch = (search: Record<string, unknown>) => ({
  [RETURN_TO_PARAM]: typeof search[RETURN_TO_PARAM] === "string" ? (search[RETURN_TO_PARAM] as string) : undefined,
});

/** One login page for password, passkey, and magic link. A fresh install goes to setup first. */
export function LoginPage() {
  const status = useQuery(IamService.method.getSetupStatus, {});
  if (status.data?.needsSetup) return <Navigate to="/setup" />;
  return (
    <AuthCard title="Sign in to LumaVault" description="Use your password, a passkey, or an emailed link.">
      <div className="flex flex-col gap-6">
        <LoginForm />
        <FieldSeparator>or get a link</FieldSeparator>
        <MagicLinkForm />
      </div>
    </AuthCard>
  );
}

function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" description="We will email you a link to choose a new one." footer={<Link to="/login">Back to sign in</Link>}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}

function ResetPasswordPage() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  if (!token) {
    return <AuthCard title="This link is not valid" footer={<Link to="/forgot-password">Ask for a new link</Link>}>{null}</AuthCard>;
  }
  return (
    <AuthCard title="Choose a new password">
      <ResetPasswordForm token={token} onDone={() => void navigate({ to: "/login" })} />
    </AuthCard>
  );
}

export const routes = [
  createRoute({ getParentRoute: () => publicRoute, path: "/login", component: LoginPage, validateSearch: returnToSearch }),
  createRoute({ getParentRoute: () => publicRoute, path: "/forgot-password", component: ForgotPasswordPage }),
  createRoute({
    getParentRoute: () => publicRoute,
    path: "/reset-password",
    component: ResetPasswordPage,
    validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === "string" ? s.token : undefined }),
  }),
];
