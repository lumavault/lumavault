import { RETURN_TO_PARAM, safeReturnUrl } from "@lumavault/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { config, knownOrigins } from "@/config";

/**
 * After sign-in, sends the visitor back where they came from: a Portal page through the
 * router, or another LumaVault app with a full page load. Anything else lands on the Portal home.
 */
export function useFinishSignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const raw = typeof search[RETURN_TO_PARAM] === "string" ? (search[RETURN_TO_PARAM] as string) : null;
  return async () => {
    // Everything cached so far was fetched signed out.
    queryClient.removeQueries();
    const target = new URL(safeReturnUrl(raw, knownOrigins, `${config.portalUrl}/`));
    if (target.origin === new URL(config.portalUrl).origin) {
      await navigate({ to: target.pathname + target.search });
    } else {
      window.location.assign(target.toString());
    }
  };
}
