import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeAuthClient, renderPortal } from "@/mocks/render";

describe("account page", () => {
  it("adds a passkey, changes the password, and signs out", async () => {
    const addPasskey = vi.fn(async () => ({ data: {}, error: null }));
    const changePassword = vi.fn(async () => ({ data: {}, error: null }));
    const signOut = vi.fn(async () => ({ data: {}, error: null }));
    const { router } = renderPortal("/account", { auth: fakeAuthClient({ passkey: { addPasskey }, changePassword, signOut }) });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name this device"), "Work laptop");
    await user.click(screen.getByRole("button", { name: /add a passkey/i }));
    expect(addPasskey).toHaveBeenCalledWith({ name: "Work laptop" });
    expect(await screen.findByText("Passkey added.")).toBeDefined();

    await user.type(screen.getByLabelText("Current password"), "old password");
    await user.type(screen.getByLabelText("New password"), "a new password");
    await user.type(screen.getByLabelText("Confirm new password"), "a new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: "old password", newPassword: "a new password", revokeOtherSessions: true });

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});
