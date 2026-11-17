import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderPortal } from "@/mocks/render";
import { seedState } from "@/mocks/state";

async function enter(code: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Code"), code);
  await user.click(screen.getByRole("button", { name: "Approve" }));
}

describe("Apple TV pairing page", () => {
  it("approves a code typed in lower case and names the device", async () => {
    const state = seedState();
    renderPortal("/pair", { state });
    await enter("abc234");
    expect(await screen.findByText("Living Room is signed in")).toBeDefined();
    expect(state.pairings[0]?.status).toBe("approved");
  });

  it("explains a wrong code", async () => {
    renderPortal("/pair");
    await enter("ZZZ999");
    expect(await screen.findByText(/That code did not work/)).toBeDefined();
  });

  it("treats an expired or burned code the same way", async () => {
    const state = seedState();
    state.pairings[0]!.status = "expired";
    renderPortal("/pair", { state });
    await enter("ABC234");
    expect(await screen.findByText(/start pairing again on the TV/)).toBeDefined();
  });

  it("ignores characters the TV never shows and waits for six", async () => {
    renderPortal("/pair");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Code"), "A0O1B");
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
  });
});
