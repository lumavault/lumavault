import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

describe("setup page", () => {
  it("creates the owner and their household, then opens the dashboard", async () => {
    const state = seedState({ viewerId: null, needsSetup: true, users: [], households: [] });
    const { router } = renderPortal("/setup", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Email"), "grace@example.com");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.type(screen.getByLabelText("Household name"), "Hopper House");
    await user.click(screen.getByRole("button", { name: /create owner account/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(state.users[0]).toMatchObject({ email: "grace@example.com", superAdmin: true });
    expect(await screen.findByText("Hopper House")).toBeDefined();
  });

  it("shows the server's reason when the email is not the preset admin", async () => {
    const state = seedState({ viewerId: null, needsSetup: true, adminEmail: "owner@example.com" });
    renderPortal("/setup", { state });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your name"), "Mallory");
    await user.type(screen.getByLabelText("Email"), "mallory@example.com");
    await user.type(screen.getByLabelText("Password"), "a long password");
    await user.type(screen.getByLabelText("Confirm password"), "a long password");
    await user.type(screen.getByLabelText("Household name"), "Nope");
    await user.click(screen.getByRole("button", { name: /create owner account/i }));
    expect(await screen.findByText(/different admin email/)).toBeDefined();
  });

  it("says when the server is already set up", async () => {
    renderPortal("/setup", { state: seedState({ viewerId: null }) });
    expect(await screen.findByText(/already set up/)).toBeDefined();
  });
});
