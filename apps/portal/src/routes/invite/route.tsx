import { useMutation } from "@connectrpc/connect-query";
import { IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { RETURN_TO_PARAM } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/form-alert";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { publicRoute } from "@/layout/routes";
import { errorMessage, useSignedIn } from "@/lib/session";

/** Signed out: create an account here, or sign in and come straight back. */
function SignedOutInvite({ inviteToken, title }: { inviteToken?: string; title: string }) {
  const queryClient = useQueryClient();
  const href = useRouterState({ select: (s) => s.location.href });
  return (
    <AuthCard
      title={title}
      description="Create your LumaVault account to continue."
      footer={
        <span>
          Already have an account?{" "}
          <Link to="/login" search={{ [RETURN_TO_PARAM]: href }} className="underline underline-offset-2">
            Sign in
          </Link>
        </span>
      }
    >
      <SignUpForm inviteToken={inviteToken} onDone={() => queryClient.invalidateQueries()} />
    </AuthCard>
  );
}

/** Redeems a household creation invite from the server owner. */
export function HouseholdInvitePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const { signedIn } = useSignedIn();
  const redeem = useMutation(IamService.method.redeemHouseholdInvite);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  if (signedIn === undefined) return <Skeleton className="h-64 w-full" />;
  if (!signedIn) return <SignedOutInvite inviteToken={token} title="You are invited to LumaVault" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await redeem.mutateAsync({ token, householdName: name.trim() });
    } catch {
      return;
    }
    queryClient.removeQueries();
    await navigate({ to: "/" });
  };
  return (
    <AuthCard title="Create your household" description="You will be its Admin and can invite the people you live with.">
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="householdName">Household name</FieldLabel>
            <Input id="householdName" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <FormError message={redeem.error && errorMessage(redeem.error)} />
          <Button type="submit" disabled={!name.trim() || redeem.isPending}>
            Create household
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}

/** Joins a household from a member invite. The invite must be for the signed-in email. */
export function MemberInvitePage() {
  const { inviteId } = useParams({ strict: false }) as { inviteId: string };
  const { signedIn, viewer } = useSignedIn();
  const accept = useMutation(IamService.method.acceptMemberInvite);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (signedIn === undefined) return <Skeleton className="h-64 w-full" />;
  if (!signedIn) return <SignedOutInvite title="You are invited to a household" />;
  return (
    <AuthCard title="Join the household" description={`You are signed in as ${viewer.data?.user?.email}.`}>
      <div className="flex flex-col gap-4">
        <FormError message={accept.error && errorMessage(accept.error)} />
        <Button
          disabled={accept.isPending}
          onClick={async () => {
            try {
              await accept.mutateAsync({ inviteId });
            } catch {
              return;
            }
            queryClient.removeQueries();
            await navigate({ to: "/" });
          }}
        >
          Accept invite
        </Button>
      </div>
    </AuthCard>
  );
}

export const routes = [
  createRoute({ getParentRoute: () => publicRoute, path: "/invite/household/$token", component: HouseholdInvitePage }),
  createRoute({ getParentRoute: () => publicRoute, path: "/invite/member/$inviteId", component: MemberInvitePage }),
];
