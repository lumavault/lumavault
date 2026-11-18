import { useMutation, useQuery } from "@connectrpc/connect-query";
import { type GracePeriod, type Household, IamService, Role, type Usage } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useQueryClient } from "@tanstack/react-query";

/** The signed-in viewer, from IamService.GetViewer. */
export function useViewer() {
  return useQuery(IamService.method.getViewer, {});
}

export interface ViewerHousehold {
  /** The viewer's one household, or undefined when they belong to none. */
  household: Household | undefined;
  role: Role;
  usage: Usage | undefined;
  /** Set while the viewer is in a grace period after leaving or being removed. */
  gracePeriod: GracePeriod | undefined;
  /** True when the household is suspended; apps show a banner. */
  suspended: boolean;
  isLoading: boolean;
}

/** The viewer's household, read from the server, so all four apps agree. */
export function useHousehold(): ViewerHousehold {
  const viewer = useViewer();
  const household = viewer.data?.household;
  return {
    household,
    role: viewer.data?.role ?? Role.UNSPECIFIED,
    usage: viewer.data?.usage,
    gracePeriod: viewer.data?.gracePeriod,
    suspended: household?.suspended ?? false,
    isLoading: viewer.isLoading,
  };
}

// Changing household makes every cached query stale, since all data on screen belonged to
// the old household. Mounted queries, including the viewer, refetch.
function useDropCacheOnSuccess() {
  const queryClient = useQueryClient();
  return { onSuccess: async () => queryClient.removeQueries() };
}

/** Uses an invite to join or create a household, moving the viewer's data along. */
export function useJoinHousehold() {
  return useMutation(IamService.method.joinHousehold, useDropCacheOnSuccess());
}

/** Leaves the household without joining another, starting the grace period. */
export function useLeaveHousehold() {
  return useMutation(IamService.method.leaveHousehold, useDropCacheOnSuccess());
}
