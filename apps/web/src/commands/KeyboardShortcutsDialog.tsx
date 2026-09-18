import { type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import "./KeyboardShortcutsDialog.css";

const shortcuts = [
  ["Mod + K", "Abrir busca global"],
  ["Mod + /", "Mostrar atalhos"],
  ["Alt + ↑", "Conversa anterior"],
  ["Alt + ↓", "Próxima conversa"],
] as const;

export default function KeyboardShortcutsDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }

  return createPortal(
    <div className="keyboard-shortcuts__backdrop" onMouseDown={onClose}>
      <div
        className="keyboard-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="keyboard-shortcuts__header">
          <h2 id="keyboard-shortcuts-title">Atalhos de teclado</h2>
          <button type="button" aria-label="Fechar atalhos" onClick={onClose}>
            ×
          </button>
        </header>
        <p>Use Ctrl no Windows/Linux ou Cmd no macOS.</p>
        <dl>
          {shortcuts.map(([shortcut, description]) => (
            <div key={shortcut}>
              <dt>
                <kbd>{shortcut}</kbd>
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
