import { Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

describe("household page for the Owner", () => {
  it("shows storage, members, and who the Owner is", async () => {
    renderPortal("/household");
    expect(await screen.findByText("800 GB of 2 TB used")).toBeDefined();
    const row = await screen.findByRole("row", { name: /Ada Lovelace/ });
    expect(within(row).getByText("Owner")).toBeDefined();
    expect(screen.getByText("2 seats left. Pending invites hold a seat until they are used or cancelled.")).toBeDefined();
  });

  it("invites someone, shows a copyable link, and counts the pending seat", async () => {
    const state = seedState();
    renderPortal("/household", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "Mary@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toMatch(/\/invite\/member\//);
    expect(state.households[0]!.invites).toEqual([expect.objectContaining({ email: "mary@example.com", role: Role.MEMBER })]);
    expect(await screen.findByText(/^1 seat left/)).toBeDefined();
    expect(screen.getByText("mary@example.com")).toBeDefined();
  });

  it("explains when the member limit is reached", async () => {
    const state = seedState();
    state.households[0]!.memberLimit = 2;
    renderPortal("/household", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "one@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText(/no free seats/)).toBeDefined();
  });

  it("removes a member into their grace period and shows the held storage", async () => {
    const state = seedState();
    renderPortal("/household", { state });
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Manage Ada Lovelace" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Manage Charles Babbage" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(state.households[0]!.members.map((m) => m.userId)).toEqual(["u-owner"]));
    expect(state.grace["u-member"]?.householdName).toBe("Lovelace Home");
    expect(await screen.findByText(/50 GB of that is held for people who left/)).toBeDefined();
  });

  it("hands the Owner role to another member", async () => {
    const state = seedState();
    renderPortal("/household", { state });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Manage Charles Babbage" }));
    await user.click(await screen.findByRole("menuitem", { name: "Make Owner" }));
    await waitFor(() =>
      expect(state.households[0]!.members).toEqual([
        { userId: "u-owner", role: Role.ADMIN },
        { userId: "u-member", role: Role.OWNER },
      ]),
    );
  });

  it("names the next Owner before leaving", async () => {
    const state = seedState();
    const { router } = renderPortal("/household", { state });
    const user = userEvent.setup();
    const leave = await screen.findByRole("button", { name: "Leave Lovelace Home" });
    expect(leave.hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Charles Babbage" }));
    await user.click(leave);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.households[0]!.members).toEqual([{ userId: "u-member", role: Role.OWNER }]);
    expect(state.grace["u-owner"]).toBeDefined();
  });

  it("cancels a pending invite", async () => {
    const state = seedState();
    state.households[0]!.invites.push({ id: "mi-9", email: "late@example.com", role: Role.MEMBER });
    renderPortal("/household", { state });
    const row = (await screen.findByText("late@example.com")).closest("tr")!;
    await userEvent.setup().click(within(row).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(state.households[0]!.invites).toEqual([]));
  });
});

describe("household page for a Member", () => {
  it("is read-only apart from leaving", async () => {
    const state = seedState({ viewerId: "u-member" });
    renderPortal("/household", { state });
    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage / })).toBeNull();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Leave Lovelace Home" }));
    await waitFor(() => expect(state.grace["u-member"]).toBeDefined());
  });
});
