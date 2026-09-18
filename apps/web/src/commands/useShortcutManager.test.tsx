import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createCommandRegistry } from "./commandRegistry";
import { useShortcutManager } from "./useShortcutManager";

describe("useShortcutManager", () => {
  it("navigates from the composer without intercepting native undo", () => {
    const openSearch = vi.fn();
    const previousConversation = vi.fn();
    const nextConversation = vi.fn();
    const registry = createCommandRegistry({
      openSearch,
      openShortcutHelp: vi.fn(),
      previousConversation,
      nextConversation,
    });
    const { container } = render(<ShortcutHarness registry={registry} />);
    const composer = container.querySelector("textarea")!;
    const richComposer = container.querySelector("[contenteditable]")!;

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(composer, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(richComposer, { key: "ArrowUp", altKey: true });
    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(undoEvent);

    expect(openSearch).toHaveBeenCalledOnce();
    expect(nextConversation).toHaveBeenCalledOnce();
    expect(previousConversation).toHaveBeenCalledOnce();
    expect(undoEvent.defaultPrevented).toBe(false);
  });
});

function ShortcutHarness({ registry }: { registry: ReturnType<typeof createCommandRegistry> }) {
  useShortcutManager(registry, ["global"]);
  return (
    <>
      <textarea aria-label="Composer" />
      <div aria-label="Rich composer" contentEditable />
    </>
  );
}
