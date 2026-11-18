import { useQuery } from "@connectrpc/connect-query";
import { IamService, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useHousehold } from "@lumavault/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createRoute, Navigate } from "@tanstack/react-router";
import { appRoute } from "@/layout/routes";
import { InviteCard } from "./invite-card";
import { LeaveCard } from "./leave-card";
import { MembersCard } from "./members-card";
import { StorageCard } from "./storage-card";

/** Storage and members for the viewer's household. Members see it read-only; Admins and the Owner manage it. */
export function HouseholdPage() {
  const { household, role, isLoading } = useHousehold();
  const members = useQuery(IamService.method.listMembers, {}, { enabled: Boolean(household) });
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  if (!isLoading && !household) return <Navigate to="/" />;
  const canManage = role === Role.OWNER || role === Role.ADMIN;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <StorageCard />
        {canManage && members.data && <InviteCard seatsRemaining={members.data.seatsRemaining} onChange={refresh} />}
      </div>
      <div className="flex flex-col gap-4">
        <MembersCard data={members.data} onChange={refresh} />
        {members.data && <LeaveCard members={members.data.members} />}
      </div>
    </div>
  );
}

export const route = createRoute({ getParentRoute: () => appRoute, path: "/household", component: HouseholdPage, staticData: { title: "Household" } });
