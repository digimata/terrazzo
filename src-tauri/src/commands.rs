//! Thin `#[tauri::command]` wrappers. All logic lives in `workspace/` and
//! `media/`; commands only resolve state, validate paths, and delegate.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use serde::Serialize;

use crate::error::AppResult;
use crate::media::poster;
use crate::state::{AppState, Workspace};
use crate::workspace::{import, paths, scan, sidecar, watch};

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

#[tauri::command]
pub fn rescan(state: State<AppState>) -> AppResult<Vec<scan::FileEntry>> {
    scan::scan(&state.root()?)
}

#[tauri::command]
pub fn generate_poster(state: State<AppState>, video_path: String) -> AppResult<String> {
    let root = state.root()?;
    let video = paths::ensure_inside(&root, Path::new(&video_path))?;
    let out = poster::generate(&root, &video)?;
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
