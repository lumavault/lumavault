import { Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeAuthClient, renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

describe("household invite page", () => {
  it("lets a signed-in person redeem the invite and lands on their new household", async () => {
    const state = seedState();
    state.householdInvites.push({ id: "hi-1", token: "tok-1", storageCapBytes: 100n, enabledApps: [1], memberLimit: 4, note: "", redeemed: false });
    const { router } = renderPortal("/invite/household/tok-1", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Household name"), "Babbage Flat");
    await user.click(screen.getByRole("button", { name: /create household/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.households.map((h) => h.name)).toContain("Babbage Flat");
    expect(state.householdInvites[0]?.redeemed).toBe(true);
  });

  it("shows why a used invite does not work", async () => {
    const state = seedState();
    state.householdInvites.push({ id: "hi-2", token: "tok-2", storageCapBytes: 1n, enabledApps: [], memberLimit: 4, note: "", redeemed: true });
    renderPortal("/invite/household/tok-2", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Household name"), "Again");
    await user.click(screen.getByRole("button", { name: /create household/i }));
    expect(await screen.findByText(/already used/)).toBeDefined();
  });

  it("asks a signed-out visitor to create an account, sending the invite token", async () => {
    const email = vi.fn(async () => ({ data: {}, error: null }));
    renderPortal("/invite/household/tok-3", { state: seedState({ viewerId: null }), auth: fakeAuthClient({ signUp: { email } }) });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "New Person");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(email).toHaveBeenCalledWith(
      { name: "New Person", email: "new@example.com", password: "a long password" },
      { headers: { "X-LumaVault-Invite": "tok-3" } },
    );
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toContain("returnTo=");
  });
});

describe("member invite page", () => {
  it("joins the household when the invite is for the signed-in email", async () => {
    const state = seedState();
    const newcomer = { id: "u-new", name: "Mary", email: "mary@example.com", superAdmin: false, banned: false };
    state.users.push(newcomer);
    state.viewerId = newcomer.id;
    state.activeHouseholdId = null;
    state.households[0]!.invites.push({ id: "mi-1", email: "mary@example.com", role: Role.MEMBER });
    const { router } = renderPortal("/invite/member/mi-1", { state });
    await userEvent.setup().click(await screen.findByRole("button", { name: /accept invite/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.households[0]!.members.map((m) => m.userId)).toContain("u-new");
  });

  it("explains an invite meant for someone else", async () => {
    const state = seedState();
    state.households[0]!.invites.push({ id: "mi-2", email: "someone@example.com", role: Role.MEMBER });
    renderPortal("/invite/member/mi-2", { state });
    await userEvent.setup().click(await screen.findByRole("button", { name: /accept invite/i }));
    expect(await screen.findByText(/another email address/)).toBeDefined();
  });
});
