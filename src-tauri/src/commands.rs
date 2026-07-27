//! Thin `#[tauri::command]` wrappers. All logic lives in `workspace/` and
//! `media/`; commands only resolve state, validate paths, and delegate.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use serde::Serialize;

use crate::error::AppResult;
use crate::media::{markdown, poster};
use crate::state::{AppState, Workspace};
use crate::workspace::{drafts, import, layout, paths, scan, sidecar, watch};

/// Mirrored by `WorkspaceInfo` in `src/app/ipc/types.ts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub meta: sidecar::WorkspaceMeta,
}

#[tauri::command]
pub fn set_workspace(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> AppResult<WorkspaceInfo> {
    let root = paths::canonical_root(&PathBuf::from(&path))?;

    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| crate::error::AppError::new(crate::error::ErrorCode::Io, e.to_string()))?;

    let meta = sidecar::load_or_create(&root)?;
    let watcher = watch::spawn(app.clone(), &root)?;
    *state.0.lock().unwrap() = Some(Workspace {
        root: root.clone(),
        _watcher: watcher,
    });
    Ok(WorkspaceInfo {
        root: root.to_string_lossy().to_string(),
        meta,
    })
}

/// Immediate children of one directory — the unit a canvas hydrates from.
#[tauri::command]
pub fn list_dir(state: State<AppState>, path: String) -> AppResult<Vec<scan::FileEntry>> {
    let root = state.root()?;
    let dir = paths::ensure_inside(&root, Path::new(&path))?;
    scan::list_dir(&dir)
}

/// Reconcile one directory's listing with its layout sidecar and return the
/// canvas items plus the hidden unsupported-file count (v0 plan §4.2: the
/// tldraw store is a projection of this).
#[tauri::command]
pub fn open_directory(
    state: State<AppState>,
    path: String,
) -> AppResult<layout::DirectoryView> {
    let root = state.root()?;
    let dir = paths::ensure_inside(&root, Path::new(&path))?;
    layout::open_directory(&dir)
}

/// Persist layout deltas for one directory after an interaction ends.
#[tauri::command]
pub fn apply_layout(
    state: State<AppState>,
    path: String,
    deltas: Vec<layout::LayoutDelta>,
) -> AppResult<()> {
    let root = state.root()?;
    let dir = paths::ensure_inside(&root, Path::new(&path))?;
    layout::apply_deltas(&dir, &deltas)
}

#[tauri::command]
pub fn rescan(state: State<AppState>) -> AppResult<Vec<scan::FileEntry>> {
    scan::scan(&state.root()?)
}

/// Async so ffmpeg runs off the main thread (the canvas never blocks on
/// thumbnail generation, PR-014).
#[tauri::command]
pub async fn ensure_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<String> {
    let root = state.root()?;
    let source = paths::ensure_inside(&root, Path::new(&path))?;
    let out = poster::ensure(&root, &source)?;
    Ok(out.to_string_lossy().to_string())
}

/// Create a new folder ("Space") inside a directory. Names are collision-
/// safe: Untitled, Untitled 2, … — never overwrites, never errors on a
/// taken name. Returns the created entry; the watcher's event drives the
/// canvas reconcile that places its card.
#[tauri::command]
pub fn create_folder(state: State<AppState>, parent: String) -> AppResult<scan::FileEntry> {
    let root = state.root()?;
    let dir = paths::ensure_inside(&root, Path::new(&parent))?;
    let mut name = String::from("Untitled");
    let mut n = 1;
    while dir.join(&name).exists() {
        n += 1;
        name = format!("Untitled {n}");
    }
    let target = dir.join(&name);
    std::fs::create_dir(&target)?;
    scan::entry_for(&target)
}

/// Render a Markdown file to static preview HTML for its canvas note card
/// (PR-009). Raw HTML in the source is demoted to text, never interpreted.
#[tauri::command]
pub async fn render_markdown(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let root = state.root()?;
    let target = paths::ensure_inside(&root, Path::new(&path))?;
    let text = std::fs::read_to_string(&target)?;
    Ok(markdown::render_preview(&text))
}

/// Mirrored by `TextDoc` in `src/app/ipc/types.ts`. The mtime rides along
/// with every read/write so document mode can tell its own save echoes
/// apart from external edits (M4 conflict handling).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDoc {
    pub contents: String,
    pub mtime_ns: String,
}

fn mtime_ns(path: &Path) -> AppResult<String> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path)?;
    let ns = (meta.mtime() as i128) * 1_000_000_000 + i128::from(meta.mtime_nsec());
    Ok(ns.to_string())
}

/// Read a text file for document mode (M4). The `.md` buffer on disk stays
/// canonical — the editor holds a copy, never a second source of truth.
#[tauri::command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> AppResult<TextDoc> {
    let root = state.root()?;
    let target = paths::ensure_inside(&root, Path::new(&path))?;
    Ok(TextDoc {
        contents: std::fs::read_to_string(&target)?,
        mtime_ns: mtime_ns(&target)?,
    })
}

/// Atomic save for document mode: temp file + rename, same discipline as
/// the sidecars, so a crash mid-write never truncates a note. Returns the
/// file's new mtime — the caller's next fs-event with this stamp is an echo.
#[tauri::command]
pub async fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    contents: String,
) -> AppResult<String> {
    let root = state.root()?;
    let target = paths::ensure_inside(&root, Path::new(&path))?;
    sidecar::write_atomic(&target, contents.as_bytes())?;
    mtime_ns(&target)
}

/// Mirror the document buffer to a recovery draft (M4). Keyed by the item's
/// layout UUID — outside the workspace, so it never shows up on a canvas.
#[tauri::command]
pub async fn write_draft(app: AppHandle, item_id: String, contents: String) -> AppResult<()> {
    drafts::write(&app, &item_id, &contents)
}

/// The recovery draft for an item, or null when none exists. A draft newer
/// than the file means the last session didn't close cleanly.
#[tauri::command]
pub async fn read_draft(app: AppHandle, item_id: String) -> AppResult<Option<TextDoc>> {
    Ok(drafts::read(&app, &item_id)?.map(|(contents, mtime_ns)| TextDoc {
        contents,
        mtime_ns,
    }))
}

/// Drop an item's recovery draft (clean close, or the user discarded it).
#[tauri::command]
pub async fn delete_draft(app: AppHandle, item_id: String) -> AppResult<()> {
    drafts::delete(&app, &item_id)
}

/// Move items to the system Trash (v0 §4.5). Async: Trash goes through
/// NSFileManager on macOS — keep disk work off the main thread.
#[tauri::command]
pub async fn move_to_trash(
    state: State<'_, AppState>,
    path: String,
    ids: Vec<String>,
) -> AppResult<()> {
    let root = state.root()?;
    let dir = paths::ensure_inside(&root, Path::new(&path))?;
    layout::trash_items(&dir, &ids)
}

/// Open a file or directory with its system default application. macOS-only
/// for v0 (`/usr/bin/open`).
#[tauri::command]
pub async fn open_item(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let root = state.root()?;
    let target = paths::ensure_inside(&root, Path::new(&path))?;
    let status = std::process::Command::new("open").arg(&target).status()?;
    if !status.success() {
        return Err(crate::error::AppError::new(
            crate::error::ErrorCode::Io,
            format!("open failed for {}", target.display()),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn import_files(
    state: State<AppState>,
    sources: Vec<String>,
    dest_dir: Option<String>,
) -> AppResult<Vec<scan::FileEntry>> {
    let root = state.root()?;
    let dest = match dest_dir {
        Some(d) => paths::ensure_inside(&root, Path::new(&d))?,
        None => root.clone(),
    };
    import::copy_into(&dest, &sources)
}
