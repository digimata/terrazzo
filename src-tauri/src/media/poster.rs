use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::workspace::scan::{self, FileKind};

/// Ensure a thumbnail exists for an image or video and return its path.
/// Outputs live in `.canvas/thumbnails/` under the workspace root (PR-012:
/// derived data, always rebuildable), keyed by stem + inode so a renamed
/// file reuses its thumbnail and same-named files don't collide. Stale
/// thumbnails (older than the source) regenerate.
///
/// Videos get a poster frame at 0.5s (PR-004: poster-at-rest); images get a
/// 640px-wide downscale. SVG is not ffmpeg territory — callers render the
/// original directly.
pub fn ensure(root: &Path, source: &Path) -> AppResult<PathBuf> {
    let thumbs = root.join(".canvas").join("thumbnails");
    std::fs::create_dir_all(&thumbs)?;

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new(ErrorCode::BadFilename, "unreadable filename"))?;
    let source_meta = source.metadata()?;
    let out = thumbs.join(format!("{stem}-{}.jpg", source_meta.ino()));

    if let Ok(out_meta) = out.metadata() {
        if out_meta.mtime() > source_meta.mtime() {
            return Ok(out);
        }
    }

    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-y");
    if scan::classify(source) == FileKind::Video {
        cmd.args(["-ss", "0.5"]);
    }
    cmd.arg("-i").arg(source);
    cmd.args(["-frames:v", "1", "-vf", "scale='min(640,iw)':-2"]);
    cmd.arg(&out);

    let output = cmd
        .output()
        .map_err(|e| AppError::new(ErrorCode::Ffmpeg, format!("ffmpeg spawn failed: {e}")))?;
    if !output.status.success() {
        return Err(AppError::new(
            ErrorCode::Ffmpeg,
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    Ok(out)
}
