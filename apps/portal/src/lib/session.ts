import { Code, ConnectError } from "@connectrpc/connect";
import { useViewer } from "@lumavault/ui";

/** Whether anyone is signed in, from IamService.GetViewer, for pages that work both ways. */
export function useSignedIn(): { signedIn: boolean | undefined; viewer: ReturnType<typeof useViewer> } {
  const viewer = useViewer();
  if (viewer.data) return { signedIn: true, viewer };
  if (viewer.error && ConnectError.from(viewer.error).code === Code.Unauthenticated) return { signedIn: false, viewer };
  return { signedIn: undefined, viewer };
}

export function errorMessage(err: unknown): string {
  return ConnectError.from(err).rawMessage;
}
