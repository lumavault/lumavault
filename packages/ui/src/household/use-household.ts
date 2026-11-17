import { useMutation, useQuery } from "@connectrpc/connect-query";
import { type Membership, IamService } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { useQueryClient } from "@tanstack/react-query";

/** The signed-in viewer, from IamService.GetViewer. */
export function useViewer() {
  return useQuery(IamService.method.getViewer, {});
}

export interface ActiveHousehold {
  membership: Membership | undefined;
  /** True when the active household is suspended; apps show a banner and offer a switch. */
  suspended: boolean;
  isLoading: boolean;
}

/** The active household. The server session is the only source, so all four apps agree. */
export function useActiveHousehold(): ActiveHousehold {
  const viewer = useViewer();
  const id = viewer.data?.activeHouseholdId;
  const membership = viewer.data?.memberships.find((m) => m.household?.id === id);
  return { membership, suspended: membership?.household?.suspended ?? false, isLoading: viewer.isLoading };
}

/**
 * Switches the active household on the server, then drops every cached query, since all data
 * on screen belonged to the old household. Mounted queries, including the viewer, refetch.
 */
export function useSwitchHousehold() {
  const queryClient = useQueryClient();
  return useMutation(IamService.method.setActiveHousehold, {
    onSuccess: async () => {
      queryClient.removeQueries();
    },
  });
}
