// Layered keymaps: one window listener (the dispatcher, mounted once in
// App), many declarative keymaps. Keyboard ownership follows the mode
// (v0 plan §4.3) — a component declares its bindings with useKeymap and
// they participate in a stack: last mounted is topmost, dispatcher walks
// top-down, first match wins. A future Vim compartment is just another
// layer that claims Escape without touching anyone else.

import { useEffect, useRef } from "react";

/** "Escape", "cmd+[", "cmd+shift+k", "alt+arrowleft" … lowercase, +-joined,
 * modifiers in any order. */
export type KeyBinding = string;
export type Keymap = Record<KeyBinding, (e: KeyboardEvent) => void>;

const stack: Keymap[] = [];

function normalize(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("cmd");
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

function normalizeBinding(binding: string): string {
  const parts = binding.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const order = ["cmd", "ctrl", "alt", "shift"].filter((m) => mods.has(m));
  return [...order, key].join("+");
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA")
  );
}

function dispatch(e: KeyboardEvent) {
  // Escape is the app's everywhere: never let macOS treat it as
  // exit-fullscreen, whether or not a layer handles it.
  if (e.key === "Escape") e.preventDefault();

  // Typing wins: keys aimed at an editable element never reach the layers,
  // so a canvas backspace claim can't eat text editing. Escape is the one
  // exception — it must close document mode even mid-typing (a future Vim
  // layer overrides that by claiming Escape above the mode's layer).
  if (isEditable(e.target) && e.key !== "Escape") return;

  const combo = normalize(e);
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i][combo];
    if (handler) {
      // A claimed combo is consumed outright — stopPropagation keeps it from
      // reaching other listeners (tldraw's own keyboard handling included).
      e.preventDefault();
      e.stopPropagation();
      handler(e);
      return;
    }
  }
}

/** Mount the single keyboard dispatcher. Called once, in App. */
export function useKeyboardDispatcher() {
  useEffect(() => {
    window.addEventListener("keydown", dispatch, { capture: true });
    return () =>
      window.removeEventListener("keydown", dispatch, { capture: true });
  }, []);
}

/** Declare this component's key bindings. Layered by mount order: the most
 * recently mounted keymap wins conflicts. Bindings may change between
 * renders; the layer's position in the stack does not. */
export function useKeymap(keymap: Keymap) {
  const layer = useRef<Keymap>({});
  // Repointing the entries on every render keeps handlers' closures fresh
  // without churning the stack.
  Object.keys(layer.current).forEach((k) => delete layer.current[k]);
  for (const [binding, handler] of Object.entries(keymap)) {
    layer.current[normalizeBinding(binding)] = handler;
  }

  useEffect(() => {
    const entry = layer.current;
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
  }, []);
}
