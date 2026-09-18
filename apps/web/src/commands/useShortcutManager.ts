import { useEffect } from "react";

import type { CommandRegistry } from "./commandRegistry";
import {
  allowsShortcutInEditableTarget,
  resolveShortcut,
  shouldIgnoreShortcutTarget,
  type ShortcutScope,
} from "./shortcutManager";

/** Owns the sole document keydown listener for registered application shortcuts. */
export function useShortcutManager(registry: CommandRegistry, scopes: readonly ShortcutScope[]) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcut(event, scopes);
      if (!command) return;
      if (shouldIgnoreShortcutTarget(event.target) && !allowsShortcutInEditableTarget(command))
        return;
      event.preventDefault();
      registry.execute(command);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry, scopes]);
}
