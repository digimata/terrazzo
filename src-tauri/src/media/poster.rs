use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};

/// Extract a poster frame with ffmpeg into `.canvas/thumbnails/` under the
/// workspace root. Output is keyed by stem + inode so a renamed video reuses
/// its poster and two same-named videos don't collide.
pub fn generate(root: &Path, video: &Path) -> AppResult<PathBuf> {
    let thumbs = root.join(".canvas").join("thumbnails");
    std::fs::create_dir_all(&thumbs)?;

    let stem = video
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::new(ErrorCode::BadFilename, "unreadable filename"))?;
    let inode = video.metadata()?.ino();
    let out = thumbs.join(format!("{stem}-{inode}.jpg"));

    let output = std::process::Command::new("ffmpeg")
        .args(["-y", "-ss", "0.5", "-i"])
        .arg(video)
        .args(["-frames:v", "1", "-vf", "scale='min(640,iw)':-2"])
        .arg(&out)
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
