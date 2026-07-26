use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::workspace::scan::{entry_for, FileEntry};

/// Copy external files into a workspace directory. Copy, never move — Finder
/// drag-in is non-destructive by default (PRD PR-013). Name collisions get a
/// `-N` suffix; existing files are never overwritten.
pub fn copy_into(dest_dir: &Path, sources: &[String]) -> AppResult<Vec<FileEntry>> {
    let mut imported = Vec::new();
    for src in sources {
        let src = PathBuf::from(src);
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AppError::new(ErrorCode::BadFilename, "unreadable filename"))?;
        let dest = collision_free(dest_dir, &src, name);
        std::fs::copy(&src, &dest)?;
        imported.push(entry_for(&dest)?);
    }
    Ok(imported)
}

fn collision_free(dir: &Path, src: &Path, name: &str) -> PathBuf {
    let mut dest = dir.join(name);
    let mut counter = 1;
    while dest.exists() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let candidate = if ext.is_empty() {
            format!("{stem}-{counter}")
        } else {
            format!("{stem}-{counter}.{ext}")
        };
        dest = dir.join(candidate);
        counter += 1;
    }
    dest
}
