// Per-directory serialized layout writer (iss-0016). CanvasView remounts on
// every canvas ↔ document/media/folder transition, so the barrier between the
// old canvas's final flush and the new canvas's layout.json read has to live
// outside the component. Writes for a directory chain in submission order —
// a debounced flush can never land after (and clobber) a later teardown
// flush — and hydration awaits the tail before reading. Failed writes retain
// their deltas for retry on the next mount instead of vanishing.

import { applyLayout } from "../app/ipc/commands";
import type { LayoutDelta } from "../app/ipc/types";

type LayoutWriter = (dir: string, deltas: LayoutDelta[]) => Promise<void>;
type ErrorHandler = (error: unknown) => void;

/** Serializes layout writes by directory and retains the newest failed delta
 * for each item until a caller can restore it. */
export class LayoutQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly retained = new Map<string, Map<string, LayoutDelta>>();

  constructor(private readonly write: LayoutWriter) {}

  /** Queue one write after every earlier write for the same directory.
   * Failures are retained and reported, so the returned promise always
   * resolves after the attempt settles. */
  enqueue(
    dir: string,
    deltas: LayoutDelta[],
    onError?: ErrorHandler,
  ): Promise<void> {
    if (deltas.length === 0) return this.settled(dir);

    const run = async () => {
      try {
        await this.write(dir, deltas);
        this.discardRetained(dir, deltas);
      } catch (error) {
        this.retain(dir, deltas);
        try {
          onError?.(error);
        } catch {
          // Error presentation must not reject the persistence tail and
          // prevent later writes for this directory from running.
        }
      }
    };

    const tail = (this.tails.get(dir) ?? Promise.resolve()).then(run);
    this.tails.set(dir, tail);
    void tail.then(() => {
      if (this.tails.get(dir) === tail) this.tails.delete(dir);
    });
    return tail;
  }

  /** Resolve after every write queued before this call has settled. */
  settled(dir: string): Promise<void> {
    return this.tails.get(dir) ?? Promise.resolve();
  }

  /** Remove and return failed deltas for restoration by the next canvas. */
  takeRetained(dir: string): LayoutDelta[] {
    const kept = this.retained.get(dir);
    if (!kept) return [];
    this.retained.delete(dir);
    return [...kept.values()];
  }

  private retain(dir: string, deltas: LayoutDelta[]) {
    let kept = this.retained.get(dir);
    if (!kept) {
      kept = new Map();
      this.retained.set(dir, kept);
    }
    for (const delta of deltas) kept.set(delta.id, delta);
  }

  private discardRetained(dir: string, deltas: LayoutDelta[]) {
    const kept = this.retained.get(dir);
    if (!kept) return;
    for (const delta of deltas) kept.delete(delta.id);
    if (kept.size === 0) this.retained.delete(dir);
  }
}

const queue = new LayoutQueue(applyLayout);

/** Queue a layout write. Resolves when this write (not the whole chain) has
 * settled; failures are retained per item id and reported via onError, never
 * thrown. */
export function enqueueLayout(
  dir: string,
  deltas: LayoutDelta[],
  onError?: (e: unknown) => void,
): Promise<void> {
  return queue.enqueue(dir, deltas, onError);
}

/** Resolves once every write queued so far for the directory has settled.
 * Hydration awaits this before reading layout.json. */
export function layoutSettled(dir: string): Promise<void> {
  return queue.settled(dir);
}

/** Deltas whose write failed and haven't been superseded since. The caller
 * owns them: overlay onto hydrated frames and re-enqueue. */
export function takeRetainedLayout(dir: string): LayoutDelta[] {
  return queue.takeRetained(dir);
}
