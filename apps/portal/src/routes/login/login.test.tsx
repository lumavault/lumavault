import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeAuthClient, renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

const signedOut = () => seedState({ viewerId: null });

describe("login page", () => {
  it("signs in with email and password and returns to the page the visitor came from", async () => {
    const email = vi.fn(async () => ({ data: {}, error: null }));
    const state = signedOut();
    const { router } = renderPortal("/login?returnTo=%2Fhousehold", { state, auth: fakeAuthClient({ signIn: { email, passkey: vi.fn(), magicLink: vi.fn() } }) });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email", { selector: "#email" }), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    state.viewerId = "u-owner";
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(email).toHaveBeenCalledWith({ email: "ada@example.com", password: "correct horse" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/household"));
  });

  it("shows a plain message for a wrong password", async () => {
    const email = vi.fn(async () => ({ error: { status: 401, message: "Invalid email or password" } }));
    renderPortal("/login", { state: signedOut(), auth: fakeAuthClient({ signIn: { email } }) });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email", { selector: "#email" }), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Wrong email or password.")).toBeDefined();
  });

  it("does not follow a return link to another site", async () => {
    const state = signedOut();
    const { router } = renderPortal("/login?returnTo=https%3A%2F%2Fevil.example.com%2F", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email", { selector: "#email" }), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    state.viewerId = "u-owner";
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("signs in with a passkey", async () => {
    const passkey = vi.fn(async () => ({ data: {}, error: null }));
    renderPortal("/login", { state: signedOut(), auth: fakeAuthClient({ signIn: { passkey, email: vi.fn(), magicLink: vi.fn() } }) });
    await userEvent.setup().click(await screen.findByRole("button", { name: /passkey/i }));
    expect(passkey).toHaveBeenCalled();
  });

  it("emails a magic link that comes back to the return page", async () => {
    const magicLink = vi.fn(async () => ({ data: {}, error: null }));
    renderPortal("/login?returnTo=http%3A%2F%2Flocalhost%3A3001%2Falbums", {
      state: signedOut(),
      auth: fakeAuthClient({ signIn: { magicLink, email: vi.fn(), passkey: vi.fn() } }),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email", { selector: "#magic-link-email" }), "friend@example.com");
    await user.click(screen.getByRole("button", { name: /sign-in link/i }));
    expect(magicLink).toHaveBeenCalledWith({ email: "friend@example.com", callbackURL: "http://localhost:3001/albums" });
    expect(await screen.findByText(/Check friend@example.com/)).toBeDefined();
  });

  it("sends a fresh install to setup", async () => {
    const { router } = renderPortal("/login", { state: seedState({ viewerId: null, needsSetup: true }) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });
});

describe("password reset pages", () => {
  it("requests a reset link and sets a new password", async () => {
    const requestPasswordReset = vi.fn(async () => ({ data: {}, error: null }));
    const resetPassword = vi.fn(async () => ({ data: {}, error: null }));
    const auth = fakeAuthClient({ requestPasswordReset, resetPassword });
    renderPortal("/forgot-password", { state: signedOut(), auth });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /reset link/i }));
    expect(requestPasswordReset).toHaveBeenCalledWith({ email: "ada@example.com", redirectTo: "http://localhost:3000/reset-password" });

    const { router } = renderPortal("/reset-password?token=t1", { state: signedOut(), auth });
    await user.type(await screen.findByLabelText("New password"), "a new password");
    await user.type(screen.getByLabelText("Confirm password"), "a new password");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: "a new password", token: "t1" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});
