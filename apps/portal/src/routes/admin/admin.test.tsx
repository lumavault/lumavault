import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

describe("Super-Admin console", () => {
  it("is closed to everyone but the server owner", async () => {
    renderPortal("/admin", { state: seedState({ viewerId: "u-member" }) });
    expect(await screen.findByText(/Only the server owner/)).toBeDefined();
    expect(screen.queryByRole("tab", { name: "Households" })).toBeNull();
  });

  it("creates a household invite link with the chosen allowance and revokes it", async () => {
    const state = seedState();
    renderPortal("/admin", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Invites" }));
    await user.type(screen.getByLabelText("Who is it for?"), "The Hoppers");
    const cap = screen.getByLabelText("Storage cap (GB)");
    await user.clear(cap);
    await user.type(cap, "250");
    await user.click(screen.getByRole("button", { name: "Arcade" }));
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    expect(((await screen.findByLabelText("Invite link")) as HTMLInputElement).value).toMatch(/\/invite\/household\//);
    expect(state.householdInvites[0]).toMatchObject({
      note: "The Hoppers",
      storageCapBytes: 250_000_000_000n,
      enabledApps: [App.PHOTOS, App.CINEMA],
      memberLimit: 4,
    });

    await user.click(await screen.findByRole("button", { name: "Revoke invite The Hoppers" }));
    await waitFor(() => expect(state.householdInvites).toEqual([]));
  });

  it("changes only the edited allowance fields", async () => {
    const state = seedState();
    renderPortal("/admin", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Lovelace Home" }));
    const limit = await screen.findByLabelText("Member limit");
    await user.clear(limit);
    await user.type(limit, "6");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.households[0]!.memberLimit).toBe(6));
    expect(state.households[0]!.storageCapBytes).toBe(2_000_000_000_000n);
  });

  it("suspends and reactivates a household", async () => {
    const state = seedState();
    renderPortal("/admin", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Lovelace Home active" }));
    await waitFor(() => expect(state.households[0]!.suspended).toBe(true));
    await user.click(await screen.findByRole("switch", { name: "Lovelace Home active" }));
    await waitFor(() => expect(state.households[0]!.suspended).toBe(false));
  });

  it("finds a user and bans them, but never offers to ban yourself", async () => {
    const state = seedState();
    renderPortal("/admin", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Users" }));
    await user.type(screen.getByLabelText("Search users"), "charles");
    await user.click(await screen.findByRole("button", { name: "Ban Charles Babbage" }));
    await waitFor(() => expect(state.users.find((u) => u.id === "u-member")?.banned).toBe(true));
    await user.clear(screen.getByLabelText("Search users"));
    expect(await screen.findByRole("row", { name: /Ada Lovelace/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Ban Ada Lovelace" })).toBeNull();
  });
});
