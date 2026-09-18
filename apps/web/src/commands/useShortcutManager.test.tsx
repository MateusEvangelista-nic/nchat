import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createCommandRegistry } from "./commandRegistry";
import { useShortcutManager } from "./useShortcutManager";

describe("useShortcutManager", () => {
  it("dispatches global commands but preserves the composer native undo", () => {
    const openSearch = vi.fn();
    const registry = createCommandRegistry({
      openSearch,
      openShortcutHelp: vi.fn(),
      previousConversation: vi.fn(),
      nextConversation: vi.fn(),
    });
    const { container } = render(<ShortcutHarness registry={registry} />);
    const composer = container.querySelector("textarea")!;

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(composer, { key: "z", ctrlKey: true });

    expect(openSearch).toHaveBeenCalledOnce();
  });
});

function ShortcutHarness({ registry }: { registry: ReturnType<typeof createCommandRegistry> }) {
  useShortcutManager(registry, ["global"]);
  return <textarea aria-label="Composer" />;
}
