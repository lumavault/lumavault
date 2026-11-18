import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeAuthClient, renderPortal } from "@/mocks/render";
import { type MockState, mockUser, seedState } from "@/mocks/state";

function withHouseholdInvite(state: MockState, email: string) {
  state.householdInvites.push({ id: "hi-1", token: "tok-1", email, storageCapBytes: 500_000_000_000n, enabledApps: [App.PHOTOS], memberLimit: 4, note: "", redeemed: false });
}

/** A second household, owned by Grace, inviting someone by email. */
function withOtherHousehold(state: MockState, inviteEmail: string) {
  state.users.push(mockUser({ id: "u-grace", name: "Grace Hopper", email: "grace@example.com" }));
  state.households.push({
    id: "h-hopper", name: "Hopper House", suspended: false, storageCapBytes: 2_000_000_000_000n, enabledApps: [App.PHOTOS],
    memberLimit: 4, usedBytes: 0n, reservedBytes: 0n, members: [{ userId: "u-grace", role: Role.OWNER }],
    invites: [{ id: "mi-1", email: inviteEmail, role: Role.MEMBER }], sharedItems: [],
  });
}

describe("household creation invite", () => {
  it("lets a signed-out invitee sign up with the invited email, then name their household", async () => {
    const state = seedState({ viewerId: null });
    withHouseholdInvite(state, "newbie@example.com");
    const email = vi.fn(async (v: { email: string; name: string }) => {
      state.users.push(mockUser({ id: "u-newbie", name: v.name, email: v.email }));
      state.viewerId = "u-newbie";
      return { data: {}, error: null };
    });
    const { router } = renderPortal("/invite/household/tok-1", { state, auth: fakeAuthClient({ signUp: { email } }) });
    const user = userEvent.setup();
    expect(await screen.findByText("Server owner invited you to LumaVault")).toBeDefined();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("newbie@example.com");
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(email).toHaveBeenCalledWith({ name: "New Person", email: "newbie@example.com", password: "a long password" });

    await user.type(await screen.findByLabelText("Household name"), "Newbie Nest");
    await user.click(screen.getByRole("button", { name: "Create household" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.households.find((h) => h.name === "Newbie Nest")?.members).toEqual([{ userId: "u-newbie", role: Role.OWNER }]);
  });

  it("explains a used invite", async () => {
    const state = seedState();
    withHouseholdInvite(state, "ada@example.com");
    state.householdInvites[0]!.redeemed = true;
    renderPortal("/invite/household/tok-1", { state });
    expect(await screen.findByText(/already used/)).toBeDefined();
  });

  it("refuses someone signed in with another email", async () => {
    const state = seedState();
    withHouseholdInvite(state, "someone@example.com");
    renderPortal("/invite/household/tok-1", { state });
    expect(await screen.findByText("This invite is for someone else")).toBeDefined();
  });
});

describe("member invite", () => {
  it("adds a signed-out invitee as they sign up", async () => {
    const state = seedState({ viewerId: null });
    withOtherHousehold(state, "mary@example.com");
    // The server adds a member invitee to the household as it makes the account.
    const email = vi.fn(async (v: { email: string; name: string }) => {
      state.users.push(mockUser({ id: "u-mary", name: v.name, email: v.email }));
      state.households.find((h) => h.id === "h-hopper")!.members.push({ userId: "u-mary", role: Role.MEMBER });
      state.viewerId = "u-mary";
      return { data: {}, error: null };
    });
    const { router } = renderPortal("/invite/member/mi-1", { state, auth: fakeAuthClient({ signUp: { email } }) });
    const user = userEvent.setup();
    expect(await screen.findByText("Join Hopper House")).toBeDefined();
    await user.type(screen.getByLabelText("Name"), "Mary");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("moves a member: private data comes along, and chosen shared items are copied", async () => {
    const state = seedState({ viewerId: "u-member" });
    withOtherHousehold(state, "charles@example.com");
    const { router } = renderPortal("/invite/member/mi-1", { state });
    const user = userEvent.setup();
    expect(await screen.findByText("Move to Hopper House")).toBeDefined();
    expect(screen.getByText(/50 GB of private data/)).toBeDefined();
    await user.click(await screen.findByRole("checkbox", { name: "Summer 2026" }));
    await user.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const hopper = state.households.find((h) => h.id === "h-hopper")!;
    expect(hopper.members.map((m) => m.userId)).toContain("u-member");
    expect(hopper.sharedItems.map((i) => i.name)).toEqual(["Summer 2026"]);
    expect(state.households[0]!.sharedItems.map((i) => i.name)).toContain("Summer 2026");
  });

  it("makes an Owner leaving others behind pick the next Owner", async () => {
    const state = seedState();
    withOtherHousehold(state, "ada@example.com");
    const { router } = renderPortal("/invite/member/mi-1", { state });
    const user = userEvent.setup();
    expect(await screen.findByText(/Who owns Lovelace Home after you leave/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Move" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Charles Babbage" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.households[0]!.members).toEqual([{ userId: "u-member", role: Role.OWNER }]);
  });

  it("warns when the move closes the person's current household", async () => {
    const state = seedState();
    state.households[0]!.members = [{ userId: "u-owner", role: Role.OWNER }];
    withOtherHousehold(state, "ada@example.com");
    renderPortal("/invite/member/mi-1", { state });
    expect(await screen.findByText("Lovelace Home will close")).toBeDefined();
  });
});
