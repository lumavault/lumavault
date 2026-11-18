import { useQuery } from "@connectrpc/connect-query";
import { IamService, type InviteRef, InviteKind } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { RETURN_TO_PARAM, useJoinHousehold, useViewer } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/form-alert";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { publicRoute } from "@/layout/routes";
import { errorMessage, useSignedIn } from "@/lib/session";
import { type MoveChoices, MoveForm } from "./move-form";

/** One page for both invite links: preview, sign up if needed, then join or move. */
function InvitePage({ invite: ref }: { invite: InviteRef }) {
  const { signedIn } = useSignedIn();
  const viewer = useViewer();
  const preview = useQuery(IamService.method.getInvite, { invite: ref }, { enabled: signedIn !== undefined });
  const join = useJoinHousehold();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  const [choices, setChoices] = useState<MoveChoices>({ householdName: "", copyItems: [], nextOwnerUserId: "" });

  if (preview.error) {
    return (
      <AuthCard title="This invite cannot be used" footer={<Link to="/login">Go to sign in</Link>}>
        <p className="text-sm text-muted-foreground">{errorMessage(preview.error)}</p>
      </AuthCard>
    );
  }
  const invite = preview.data;
  if (signedIn === undefined || !invite) return <Skeleton className="h-64 w-full" />;
  const isNew = invite.kind === InviteKind.NEW_HOUSEHOLD;
  const title = isNew ? `${invite.inviterName} invited you to LumaVault` : `Join ${invite.householdName}`;

  if (!signedIn) {
    return (
      <AuthCard
        title={title}
        description={`Create your account with ${invite.email} to continue.`}
        footer={
          <span>
            Already have an account?{" "}
            <Link to="/login" search={{ [RETURN_TO_PARAM]: href }} className="underline underline-offset-2">
              Sign in
            </Link>
          </span>
        }
      >
        <SignUpForm
          email={invite.email}
          onDone={async () => {
            await queryClient.resetQueries();
            // A member invite joins the household as the account is made; there is nothing left to do.
            if (!isNew) await navigate({ to: "/" });
          }}
        />
      </AuthCard>
    );
  }

  const me = viewer.data?.user?.email.toLowerCase();
  if (me && me !== invite.email) {
    return (
      <AuthCard title="This invite is for someone else">
        <p className="text-sm text-muted-foreground">
          It was sent to {invite.email}, but you are signed in as {me}. Sign out and open the link again.
        </p>
      </AuthCard>
    );
  }

  const blocked = (isNew && !choices.householdName.trim()) || (invite.move?.mustChooseNextOwner && !choices.nextOwnerUserId);
  return (
    <AuthCard
      title={invite.move ? (isNew ? "Move to a new household" : `Move to ${invite.householdName}`) : isNew ? "Create your household" : title}
      description={isNew ? "You will be its Owner and can invite the people you live with." : `${invite.inviterName} invited you.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await join.mutateAsync({ invite: ref, ...choices });
          } catch {
            return;
          }
          await navigate({ to: "/" });
        }}
      >
        <MoveForm invite={invite} onChange={setChoices} />
        <FormError message={join.error && errorMessage(join.error)} />
        <Button type="submit" disabled={Boolean(blocked) || join.isPending}>
          {invite.move ? "Move" : isNew ? "Create household" : "Join household"}
        </Button>
      </form>
    </AuthCard>
  );
}

function HouseholdInvitePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  return <InvitePage invite={{ invite: { case: "householdInviteToken", value: token } } as InviteRef} />;
}

function MemberInvitePage() {
  const { inviteId } = useParams({ strict: false }) as { inviteId: string };
  return <InvitePage invite={{ invite: { case: "memberInviteId", value: inviteId } } as InviteRef} />;
}

export const routes = [
  createRoute({ getParentRoute: () => publicRoute, path: "/invite/household/$token", component: HouseholdInvitePage }),
  createRoute({ getParentRoute: () => publicRoute, path: "/invite/member/$inviteId", component: MemberInvitePage }),
];
