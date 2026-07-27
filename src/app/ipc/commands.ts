// Typed wrappers over Tauri invoke — the only place `invoke` is called.
// One function per Rust command in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  DirectoryView,
  FileEntry,
  LayoutDelta,
  TextDoc,
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
 * canvas items the tldraw store projects plus the hidden unsupported-file
 * count (PR-010). */
export function openDirectory(path: string): Promise<DirectoryView> {
  return invoke("open_directory", { path });
}

/** Create a new folder ("Space") inside a directory; names are
 * collision-safe (Untitled, Untitled 2, …). */
export function createFolder(parent: string): Promise<FileEntry> {
  return invoke("create_folder", { parent });
}

/** Render a Markdown file to static preview HTML for its canvas note card
 * (PR-009). Raw HTML in the source is stripped Rust-side. */
export function renderMarkdown(path: string): Promise<string> {
  return invoke("render_markdown", { path });
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

/** Read a text file for document mode (M4). The buffer on disk stays
 * canonical — the editor holds a copy, never a second source of truth. */
export function readTextFile(path: string): Promise<TextDoc> {
  return invoke("read_text_file", { path });
}

/** Atomic save for document mode: temp file + rename, so a crash mid-write
 * never truncates a note. Returns the file's new mtime. */
export function writeTextFile(path: string, contents: string): Promise<string> {
  return invoke("write_text_file", { path, contents });
}

/** Mirror the document buffer to a recovery draft, keyed by item UUID. */
export function writeDraft(itemId: string, contents: string): Promise<void> {
  return invoke("write_draft", { itemId, contents });
}

/** The item's recovery draft, or null. Newer than the file = crash signal. */
export function readDraft(itemId: string): Promise<TextDoc | null> {
  return invoke("read_draft", { itemId });
}

/** Drop an item's recovery draft (clean close, or user discarded it). */
export function deleteDraft(itemId: string): Promise<void> {
  return invoke("delete_draft", { itemId });
}

/** Copy external files into the workspace (Finder drop). Never moves or
 * overwrites. `destDir` defaults to the workspace root. */
export function importFiles(
  sources: string[],
  destDir?: string,
): Promise<FileEntry[]> {
  return invoke("import_files", { sources, destDir: destDir ?? null });
}
