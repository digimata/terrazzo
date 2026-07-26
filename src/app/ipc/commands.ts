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

/** Generate a poster frame for a video via ffmpeg; returns the poster path
 * inside `.canvas/thumbnails/`. */
export function generatePoster(videoPath: string): Promise<string> {
  return invoke("generate_poster", { videoPath });
}

/** Copy external files into the workspace (Finder drop). Never moves or
 * overwrites. `destDir` defaults to the workspace root. */
export function importFiles(
  sources: string[],
  destDir?: string,
): Promise<FileEntry[]> {
  return invoke("import_files", { sources, destDir: destDir ?? null });
}
