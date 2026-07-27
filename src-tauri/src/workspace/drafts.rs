//! Recovery drafts (M4): a mirror of the document buffer written outside
//! the workspace, keyed by the item's layout UUID so it survives renames.
//! The draft exists so a crash or failed save never loses typed text; a
//! clean close deletes it, so a surviving draft is itself the crash signal.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult, ErrorCode};

fn dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
        .join("drafts");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Draft ids are layout UUIDs; anything else is refused so an id can never
/// steer the path out of the drafts dir.
fn draft_path(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(AppError::new(
            ErrorCode::Io,
            format!("invalid draft id {id:?}"),
        ));
    }
    Ok(dir(app)?.join(format!("{id}.md")))
}

pub fn write(app: &AppHandle, id: &str, contents: &str) -> AppResult<()> {
    let path = draft_path(app, id)?;
    crate::workspace::sidecar::write_atomic(&path, contents.as_bytes())
}

/// Contents + mtime, or None when no draft exists.
pub fn read(app: &AppHandle, id: &str) -> AppResult<Option<(String, String)>> {
    let path = draft_path(app, id)?;
    if !path.is_file() {
        return Ok(None);
    }
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(&path)?;
    let ns = (meta.mtime() as i128) * 1_000_000_000 + i128::from(meta.mtime_nsec());
    Ok(Some((fs::read_to_string(&path)?, ns.to_string())))
}

pub fn delete(app: &AppHandle, id: &str) -> AppResult<()> {
    let path = draft_path(app, id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
