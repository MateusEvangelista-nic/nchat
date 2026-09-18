import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import KeyboardShortcutsDialog from "./KeyboardShortcutsDialog";

describe("KeyboardShortcutsDialog", () => {
  it("opens the shortcut reference and closes it with Escape", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Atalhos de teclado" })).toBeInTheDocument();
    expect(screen.getByText("Mod + K")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
