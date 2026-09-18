export type CommandId =
  | "search.open"
  | "shortcuts.open"
  | "conversation.previous"
  | "conversation.next";

export interface CommandActions {
  openSearch: () => void;
  openShortcutHelp: () => void;
  previousConversation: () => void;
  nextConversation: () => void;
}

export interface CommandRegistry {
  execute: (command: CommandId) => void;
}

/** Maps semantic commands to application actions; UI triggers never own those actions. */
export function createCommandRegistry(actions: CommandActions): CommandRegistry {
  const commands: Record<CommandId, () => void> = {
    "search.open": actions.openSearch,
    "shortcuts.open": actions.openShortcutHelp,
    "conversation.previous": actions.previousConversation,
    "conversation.next": actions.nextConversation,
  };

  return { execute: (command) => commands[command]() };
}
