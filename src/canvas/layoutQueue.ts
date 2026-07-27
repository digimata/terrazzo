// Per-directory serialized layout writer (iss-0016). CanvasView remounts on
// every canvas ↔ document/media/folder transition, so the barrier between the
// old canvas's final flush and the new canvas's layout.json read has to live
// outside the component. Writes for a directory chain in submission order —
// a debounced flush can never land after (and clobber) a later teardown
// flush — and hydration awaits the tail before reading. Failed writes retain
// their deltas for retry on the next mount instead of vanishing.

import { applyLayout } from "../app/ipc/commands";
import type { LayoutDelta } from "../app/ipc/types";

const tails = new Map<string, Promise<void>>();
const retained = new Map<string, Map<string, LayoutDelta>>();

/** Queue a layout write. Resolves when this write (not the whole chain) has
 * settled; failures are retained per item id and reported via onError, never
 * thrown. */
export function enqueueLayout(
  dir: string,
  deltas: LayoutDelta[],
  onError?: (e: unknown) => void,
): Promise<void> {
  if (deltas.length === 0) return tails.get(dir) ?? Promise.resolve();
  const run = async () => {
    try {
      await applyLayout(dir, deltas);
      // A newer successful write supersedes any retained failure for the
      // same items — retrying the old delta later would revert this one.
      const kept = retained.get(dir);
      if (kept) {
        for (const d of deltas) kept.delete(d.id);
        if (kept.size === 0) retained.delete(dir);
      }
    } catch (e) {
      let kept = retained.get(dir);
      if (!kept) {
        kept = new Map();
        retained.set(dir, kept);
      }
      for (const d of deltas) kept.set(d.id, d);
      onError?.(e);
    }
  };
  const tail = (tails.get(dir) ?? Promise.resolve()).then(run);
  tails.set(dir, tail);
  return tail;
}

/** Resolves once every write queued so far for the directory has settled.
 * Hydration awaits this before reading layout.json. */
export function layoutSettled(dir: string): Promise<void> {
  return tails.get(dir) ?? Promise.resolve();
}

/** Deltas whose write failed and haven't been superseded since. The caller
 * owns them: overlay onto hydrated frames and re-enqueue. */
export function takeRetainedLayout(dir: string): LayoutDelta[] {
  const kept = retained.get(dir);
  if (!kept) return [];
  retained.delete(dir);
  return [...kept.values()];
}
