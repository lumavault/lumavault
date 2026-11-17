import { AuthProvider, type LumaVaultAuthClient, LumaVaultProvider } from "@lumavault/ui";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createPortalRouter } from "@/router";
import { createMockIamTransport } from "./iam";
import { type MockState, seedState } from "./state";

/** A Better Auth client stand-in; every call succeeds unless a test overrides it. */
export function fakeAuthClient(overrides: Record<string, unknown> = {}): LumaVaultAuthClient {
  const ok = async () => ({ data: {}, error: null });
  return {
    signIn: { email: ok, magicLink: ok, passkey: ok },
    signUp: { email: ok },
    passkey: { addPasskey: ok },
    requestPasswordReset: ok,
    resetPassword: ok,
    changePassword: ok,
    signOut: ok,
    useSession: () => ({ data: null, isPending: false, error: null }),
    ...overrides,
  } as unknown as LumaVaultAuthClient;
}

/** Renders the whole Portal at path against the mocked IamService. */
export function renderPortal(path: string, options: { state?: MockState; auth?: LumaVaultAuthClient } = {}) {
  const state = options.state ?? seedState();
  const router = createPortalRouter(createMemoryHistory({ initialEntries: [path] }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <LumaVaultProvider apiUrl="http://api.test" transport={createMockIamTransport(state)} queryClient={queryClient}>
      <AuthProvider client={options.auth ?? fakeAuthClient()}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </LumaVaultProvider>,
  );
  return { ...view, router, state };
}
