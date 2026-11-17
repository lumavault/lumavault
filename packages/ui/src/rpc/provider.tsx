import type { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

// IamService and the app services are mounted here on the API server.
const RPC_PATH = "/api/rpc";

/**
 * A Connect transport to the LumaVault API that sends the session cookie, so every app shares
 * the one session the Portal signs in. Side-effect-free calls go out as GET.
 */
export function createApiTransport(apiUrl: string): Transport {
  return createConnectTransport({
    baseUrl: new URL(RPC_PATH, apiUrl).toString(),
    useHttpGet: true,
    fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
  });
}

export interface LumaVaultProviderProps {
  /** API origin, for example http://localhost:4000. */
  apiUrl: string;
  children: ReactNode;
  /** For tests: a mocked transport and a fresh query client. */
  transport?: Transport;
  queryClient?: QueryClient;
}

/** Sets up TanStack Query and Connect for an app. Apps call Connect-Query hooks directly. */
export function LumaVaultProvider({ apiUrl, children, transport, queryClient }: LumaVaultProviderProps) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  const [conn] = useState(() => transport ?? createApiTransport(apiUrl));
  return (
    <TransportProvider transport={conn}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportProvider>
  );
}
