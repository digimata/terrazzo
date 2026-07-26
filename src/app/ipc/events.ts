// Typed wrappers over Tauri events — the only place `listen` is called.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FsEvent } from "./types";

/** Filesystem changes inside the workspace root (dotfile subtrees already
 * filtered out on the Rust side). */
export function onFsEvent(handler: (event: FsEvent) => void): Promise<UnlistenFn> {
  return listen<FsEvent>("fs-event", (e) => handler(e.payload));
}
