import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, Menu, Progress, Select, Switch, Tabs, Toast, Tooltip } from "./index.js";

describe("@lumavault/ui primitives", () => {
  it("exports every primitive the apps need", () => {
    for (const part of [Dialog.Root, Menu.Root, Progress.Root, Select.Root, Switch.Root, Tabs.Root, Toast.Provider, Tooltip.Root]) {
      expect(part).toBeDefined();
    }
  });

  it("renders a dialog that the app styles with its own class and no built-in styles", () => {
    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Popup className="cinema-dialog">
            <Dialog.Title>Now playing</Dialog.Title>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    const popup = screen.getByRole("dialog");
    expect(popup.className).toBe("cinema-dialog");
    expect(popup).toHaveProperty("textContent", "Now playing");
    expect(document.querySelectorAll("style, link[rel=stylesheet]")).toHaveLength(0);
  });
});
