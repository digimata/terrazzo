//! Thin `#[tauri::command]` wrappers. All logic lives in `workspace/` and
//! `media/`; commands only resolve state, validate paths, and delegate.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use serde::Serialize;

use crate::error::AppResult;
use crate::media::poster;
use crate::state::{AppState, Workspace};
use crate::workspace::{import, layout, paths, scan, sidecar, watch};

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
/// canvas items (v0 plan §4.2: the tldraw store is a projection of this).
#[tauri::command]
pub fn open_directory(
    state: State<AppState>,
    path: String,
) -> AppResult<Vec<layout::CanvasItem>> {
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
