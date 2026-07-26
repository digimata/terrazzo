use std::path::{Path, PathBuf};

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;

pub const FS_EVENT: &str = "fs-event";

/// Start the recursive watcher for a workspace root. Events under any
/// dot-directory relative to the root (`.canvas/` above all) are dropped
/// here, before they reach the frontend — thumbnail and sidecar writes must
/// not trigger reconciliation loops.
pub fn spawn(app: AppHandle, root: &Path) -> AppResult<notify::RecommendedWatcher> {
    let root_owned: PathBuf = root.to_path_buf();
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let Ok(event) = res else { return };
            let paths: Vec<String> = event
                .paths
                .iter()
                .filter(|p| {
                    p.strip_prefix(&root_owned).is_ok_and(|rel| {
                        !rel.components()
                            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
                    })
                })
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if paths.is_empty() {
                return;
            }
            let _ = app.emit(
                FS_EVENT,
                serde_json::json!({ "kind": format!("{:?}", event.kind), "paths": paths }),
            );
        })?;
    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(watcher)
}
