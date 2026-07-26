// Application mode — exactly one is active; keyboard ownership follows the
// mode (v0 plan §4.3). The document mode does not assume Escape closes it,
// so a future Vim compartment can claim Escape without touching the canvas.

export type AppMode =
  | { type: "start" } // no workspace selected yet
  | { type: "canvas"; directoryPath: string }
  | { type: "document"; itemId: string; view: "writing" | "source" }
  | { type: "media"; itemId: string; directoryPath: string };
