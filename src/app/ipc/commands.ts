// Typed wrappers over Tauri invoke — the only place `invoke` is called.
// One function per Rust command in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  CanvasItem,
  FileEntry,
  LayoutDelta,
  WorkspaceInfo,
} from "./types";

/** Select the workspace root: validates, scopes assets, loads or creates
 * `.canvas/workspace.json`, and starts the watcher. */
export function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("set_workspace", { path });
}

/** Immediate children of one directory inside the workspace — the unit a
 * canvas hydrates from. */
export function listDir(path: string): Promise<FileEntry[]> {
  return invoke("list_dir", { path });
}

/** Reconcile one directory's listing with its layout sidecar; returns the
 * canvas items the tldraw store projects. */
export function openDirectory(path: string): Promise<CanvasItem[]> {
  return invoke("open_directory", { path });
}

/** Persist layout deltas for one directory (called after an interaction
 * ends, never during). */
export function applyLayout(
  path: string,
  deltas: LayoutDelta[],
): Promise<void> {
  return invoke("apply_layout", { path, deltas });
}

/** Re-scan the active workspace. */
export function rescan(): Promise<FileEntry[]> {
  return invoke("rescan");
}

/** Ensure a thumbnail (image downscale / video poster frame) exists for a
 * file; returns its path inside `.canvas/thumbnails/`. Runs off the main
 * thread — safe to fan out. */
export function ensureThumbnail(path: string): Promise<string> {
  return invoke("ensure_thumbnail", { path });
}

/** Move items to the system Trash (v0 §4.5): each UUID is confirmed to
 * resolve, trashed, and its layout entry dropped only after Trash succeeds. */
export function moveToTrash(path: string, ids: string[]): Promise<void> {
  return invoke("move_to_trash", { path, ids });
}

/** Open a file or directory with its system default application. */
export function openItem(path: string): Promise<void> {
  return invoke("open_item", { path });
}

/** Copy external files into the workspace (Finder drop). Never moves or
 * overwrites. `destDir` defaults to the workspace root. */
export function importFiles(
  sources: string[],
  destDir?: string,
): Promise<FileEntry[]> {
  return invoke("import_files", { sources, destDir: destDir ?? null });
}
