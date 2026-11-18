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
    await user.type(screen.getByLabelText("Email"), "Grace@example.com");
    await user.type(screen.getByLabelText("Note"), "The Hoppers");
    const cap = screen.getByLabelText("Storage cap (GB)");
    await user.clear(cap);
    await user.type(cap, "250");
    await user.click(screen.getByRole("button", { name: "Arcade" }));
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    expect(((await screen.findByLabelText("Invite link")) as HTMLInputElement).value).toMatch(/\/invite\/household\//);
    expect(state.householdInvites[0]).toMatchObject({
      email: "grace@example.com",
      note: "The Hoppers",
      storageCapBytes: 250_000_000_000n,
      enabledApps: [App.PHOTOS, App.CINEMA],
      memberLimit: 4,
    });

    await user.click(await screen.findByRole("button", { name: "Revoke invite for grace@example.com" }));
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

  it("lists each household's Owner and the storage held for people who left", async () => {
    const state = seedState();
    state.grace["u-gone"] = { householdName: "Lovelace Home", privateBytes: 20_000_000_000n, deleteAt: new Date() };
    renderPortal("/admin", { state });
    const row = await screen.findByRole("row", { name: /Lovelace Home/ });
    expect(row.textContent).toContain("ada@example.com");
    expect(row.textContent).toContain("20 GB held for people who left");
  });

  it("finds a user and bans them with a reason, but never offers to ban yourself", async () => {
    const state = seedState();
    renderPortal("/admin", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Users" }));
    await user.type(screen.getByLabelText("Search users"), "charles");
    await user.click(await screen.findByRole("button", { name: "Ban Charles Babbage" }));
    await user.type(await screen.findByLabelText("Reason"), "Shared the invite link publicly");
    await user.click(screen.getByRole("button", { name: "Ban" }));
    await waitFor(() => expect(state.users.find((u) => u.id === "u-member")).toMatchObject({ banned: true, banReason: "Shared the invite link publicly" }));
    expect(await screen.findByText("Shared the invite link publicly")).toBeDefined();
    await user.clear(screen.getByLabelText("Search users"));
    expect(await screen.findByRole("row", { name: /Ada Lovelace/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Ban Ada Lovelace" })).toBeNull();
  });
});
