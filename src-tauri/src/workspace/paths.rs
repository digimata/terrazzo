use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};

/// Canonicalize and verify a workspace root candidate.
pub fn canonical_root(path: &Path) -> AppResult<PathBuf> {
    let root = path.canonicalize()?;
    if !root.is_dir() {
        return Err(AppError::new(
            ErrorCode::NotADirectory,
            "workspace root must be a directory",
        ));
    }
    Ok(root)
}

/// The workspace root is a hard boundary: canonicalization resolves symlinks,
/// so a path that resolves outside the root is rejected no matter how it was
/// spelled.
pub fn ensure_inside(root: &Path, path: &Path) -> AppResult<PathBuf> {
    let canonical = path.canonicalize()?;
    if !canonical.starts_with(root) {
        return Err(AppError::new(
            ErrorCode::PathEscape,
            format!("path escapes workspace root: {}", canonical.display()),
        ));
    }
    Ok(canonical)
}
