// Keyboard hooks. Keyboard ownership belongs to the active mode (v0 plan
// §4.3) — components declare intent through these instead of scattering
// window listeners.

import { useEffect } from "react";

/** Claim Escape for the app: preventDefault at capture so macOS never
 * treats it as exit-fullscreen. Other listeners still receive the event.
 * Mounted once in App. */
export function useEscapeOwnedByApp() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}

/** Run `handler` when Escape is pressed while the calling mode is mounted. */
export function useEscape(handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler]);
}
