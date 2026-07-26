// Application mode — exactly one is active; keyboard ownership follows the
// mode (v0 plan §4.3). The document mode does not assume Escape closes it,
// so a future Vim compartment can claim Escape without touching the canvas.

export type AppMode =
  | { type: "spike" } // Gate 0 only; deleted when the gate closes
  | { type: "canvas"; directoryPath: string }
  | { type: "document"; itemId: string; view: "writing" | "source" }
  | { type: "media"; itemId: string };
