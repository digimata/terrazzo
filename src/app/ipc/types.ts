// Wire types for the Tauri command boundary. Each mirrors a serde struct in
// src-tauri (rename_all = "camelCase"); keep the two in sync by hand until
// codegen is worth it.

/** Mirrors `workspace::scan::FileKind`. */
export type FileKind = "image" | "video" | "pdf" | "markdown" | "dir" | "other";

/** Mirrors `workspace::scan::FileEntry`. */
export interface FileEntry {
  /** Absolute path. Always inside the workspace root. */
  path: string;
  name: string;
  kind: FileKind;
  device: number;
  inode: number;
  size: number;
  /** Nanoseconds since epoch as a string — exceeds JS safe-integer range. */
  mtimeNs: string;
  isDir: boolean;
}

/** Mirrors `workspace::layout::Frame` — page-space rect in layout.json. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors `workspace::layout::CanvasItem` — one reconciled item from
 * `open_directory`. `id` is the durable UUIDv7 from the layout sidecar. */
export interface CanvasItem {
  id: string;
  entry: FileEntry;
  /** Null until the item is first placed and persisted. */
  frame: Frame | null;
  rotation: number;
  zIndex: number;
}

/** Mirrors `workspace::layout::LayoutDelta` — one item's layout mutation. */
export interface LayoutDelta {
  id: string;
  frame: Frame;
  rotation: number;
  zIndex: number;
}

/** Mirrors `workspace::sidecar::WorkspaceMeta` (`.canvas/workspace.json`). */
export interface WorkspaceMeta {
  schemaVersion: number;
  workspaceId: string;
  name: string;
}

/** Mirrors `commands::WorkspaceInfo` — the result of `set_workspace`. */
export interface WorkspaceInfo {
  /** Canonicalized absolute root. The hard boundary. */
  root: string;
  meta: WorkspaceMeta;
}

/** Mirrors `error::AppError` — every rejected invoke carries this shape. */
export interface AppError {
  code:
    | "no_workspace"
    | "not_a_directory"
    | "path_escape"
    | "io"
    | "watcher"
    | "ffmpeg"
    | "bad_filename";
  message: string;
}

/** Payload of the `fs-event` Tauri event (see `workspace::watch`). */
export interface FsEvent {
  /** Debug-formatted notify::EventKind. Spike-grade; will become an enum. */
  kind: string;
  paths: string[];
}
