//! Workspace metadata sidecar: `<root>/.canvas/workspace.json`.
//!
//! Schema v1 (v0 plan §3): `{ schemaVersion, workspaceId, name }`. Created on
//! first open, loaded thereafter. Writes are atomic (temp file + rename) so a
//! crash can never leave a torn sidecar.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorCode};

pub const CANVAS_DIR: &str = ".canvas";
const WORKSPACE_FILE: &str = "workspace.json";

/// Mirrored by `WorkspaceMeta` in `src/app/ipc/types.ts`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub schema_version: u32,
    pub workspace_id: String,
    pub name: String,
}

/// Load `<root>/.canvas/workspace.json`, creating it (and `.canvas/`) on
/// first open. The workspace name defaults to the root directory's name.
pub fn load_or_create(root: &Path) -> AppResult<WorkspaceMeta> {
    let canvas_dir = root.join(CANVAS_DIR);
    let file = canvas_dir.join(WORKSPACE_FILE);

    if file.exists() {
        let raw = fs::read_to_string(&file)?;
        return serde_json::from_str(&raw).map_err(|e| {
            AppError::new(
                ErrorCode::Io,
                format!("corrupt workspace.json at {}: {e}", file.display()),
            )
        });
    }

    let meta = WorkspaceMeta {
        schema_version: 1,
        workspace_id: Uuid::now_v7().to_string(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "workspace".to_string()),
    };
    fs::create_dir_all(&canvas_dir)?;
    write_atomic(&file, &serde_json::to_vec_pretty(&meta).unwrap())?;
    Ok(meta)
}

/// Write via temp file + rename in the same directory, so readers only ever
/// see the old file or the complete new one.
pub fn write_atomic(dest: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = dest.with_extension("json.tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, dest)?;
    Ok(())
}
