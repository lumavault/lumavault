import { createRouterTransport } from "@connectrpc/connect";
import { App, IamService, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { formatBytes, summarizeUsage } from "../format-bytes.js";
import { LumaVaultProvider } from "../rpc/provider.js";
import { useActiveHousehold, useSwitchHousehold } from "./use-household.js";

function mockApi() {
  let active = "home";
  const households = [
    { id: "home", name: "Home", suspended: false, allowance: { enabledApps: [App.PHOTOS] } },
    { id: "cabin", name: "Cabin", suspended: true, allowance: { enabledApps: [App.CINEMA] } },
  ];
  const viewer = () => ({
    user: { id: "u1", email: "ada@example.com" },
    memberships: households.map((household) => ({ household, role: Role.ADMIN })),
    activeHouseholdId: active,
  });
  return createRouterTransport(({ rpc }) => {
    rpc(IamService.method.getViewer, viewer);
    rpc(IamService.method.setActiveHousehold, (req) => {
      active = req.householdId;
      return { viewer: viewer() };
    });
  });
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const transport = mockApi();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LumaVaultProvider apiUrl="http://api.test" transport={transport} queryClient={queryClient}>
      {children}
    </LumaVaultProvider>
  );
  return { queryClient, wrapper };
}

describe("household hooks", () => {
  it("reads the active household from the server session", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useActiveHousehold(), { wrapper });
    await waitFor(() => expect(result.current.membership?.household?.name).toBe("Home"));
    expect(result.current.suspended).toBe(false);
  });

  it("switching clears cached data and reports a suspended household", async () => {
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData(["photos", "timeline"], ["a photo from Home"]);
    const { result } = renderHook(() => ({ active: useActiveHousehold(), sw: useSwitchHousehold() }), { wrapper });
    await waitFor(() => expect(result.current.active.membership?.household?.id).toBe("home"));

    await act(async () => {
      await result.current.sw.mutateAsync({ householdId: "cabin" });
    });
    expect(queryClient.getQueryData(["photos", "timeline"])).toBeUndefined();
    await waitFor(() => expect(result.current.active.membership?.household?.id).toBe("cabin"));
    expect(result.current.active.suspended).toBe(true);
  });
});

describe("formatBytes", () => {
  it("uses decimal units with one decimal place", () => {
    expect(formatBytes(0n)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(5_000_000_000n)).toBe("5 GB");
  });

  it("stays exact for values above 9 PB and up to 64 bits", () => {
    expect(formatBytes(9_500_000_000_000_000n)).toBe("9.5 PB");
    expect(formatBytes(2n ** 64n - 1n)).toBe("18.4 EB");
  });

  it("reports usage over a lowered cap without going past 100 percent", () => {
    expect(summarizeUsage(1500n, 0n, 1000n)).toEqual({ percent: 100, overCap: true, label: "1.5 KB of 1 KB" });
    expect(summarizeUsage(250n, 250n, 1000n)).toMatchObject({ percent: 50, overCap: false });
    expect(summarizeUsage(0n, 0n, 0n)).toMatchObject({ percent: 0, overCap: false });
  });
});
