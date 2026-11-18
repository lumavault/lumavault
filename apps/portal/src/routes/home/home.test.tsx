import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

describe("home page", () => {
  it("shows a launcher card for each enabled app", async () => {
    renderPortal("/");
    for (const name of ["Photos", "Cinema", "Arcade"]) {
      expect(await screen.findByText(name)).toBeDefined();
    }
    expect(screen.getAllByRole("link", { name: /open/i }).map((a) => a.getAttribute("href"))).toEqual([
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    ]);
  });

  it("stays usable when the household is suspended, with a banner and no app links", async () => {
    const state = seedState();
    state.households[0]!.suspended = true;
    renderPortal("/", { state });
    expect(await screen.findByText(/is suspended/)).toBeDefined();
    expect(screen.queryAllByRole("link", { name: /open/i })).toHaveLength(0);
    expect(screen.getByText("Lovelace Home")).toBeDefined();
  });

  it("tells someone in a grace period how long their data is kept", async () => {
    const state = seedState();
    state.households[0]!.members = state.households[0]!.members.filter((m) => m.userId !== "u-owner");
    state.grace["u-owner"] = { householdName: "Old Place", privateBytes: 5_000_000_000n, deleteAt: new Date("2026-12-18T00:00:00Z") };
    renderPortal("/", { state });
    expect(await screen.findByText("You left Old Place")).toBeDefined();
    expect(screen.getByText(/5 GB of private data is kept, read-only/)).toBeDefined();
  });

  it("explains what to do when the viewer has no household", async () => {
    const state = seedState();
    state.households[0]!.members = state.households[0]!.members.filter((m) => m.userId !== "u-owner");
    renderPortal("/", { state });
    expect(await screen.findByText(/not in a household yet/)).toBeDefined();
  });

  it("sends signed-out visitors to login with a way back", async () => {
    const { router } = renderPortal("/", { state: seedState({ viewerId: null }) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ returnTo: "/" });
  });
});
