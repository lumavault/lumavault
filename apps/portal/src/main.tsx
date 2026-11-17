import { AuthProvider, createApiTransport, createLumaVaultAuthClient, LumaVaultProvider } from "@lumavault/ui";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { config } from "./config";
import { createMockIamTransport } from "./mocks/iam";
import { seedState } from "./mocks/state";
import { createPortalRouter } from "./router";
import "./index.css";

const transport = config.useMock ? createMockIamTransport(seedState()) : createApiTransport(config.apiUrl);
const authClient = createLumaVaultAuthClient(config.apiUrl);
const router = createPortalRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LumaVaultProvider apiUrl={config.apiUrl} transport={transport}>
      <AuthProvider client={authClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </LumaVaultProvider>
  </StrictMode>,
);
