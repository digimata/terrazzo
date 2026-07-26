use std::os::unix::fs::MetadataExt;
use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;

/// One filesystem child as the frontend sees it. Mirrored by `FileEntry` in
/// `src/app/ipc/types.ts` — keep the two in sync by hand until codegen is
/// worth it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub inode: u64,
    pub size: u64,
    /// Nanoseconds as a string: JS numbers lose precision past 2^53.
    pub mtime_ns: String,
    pub is_dir: bool,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Image,
    Video,
    Pdf,
    Markdown,
    Dir,
    Other,
}

pub fn classify(path: &Path) -> FileKind {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") => FileKind::Image,
        Some("mp4" | "mov") => FileKind::Video,
        Some("pdf") => FileKind::Pdf,
        Some("md") => FileKind::Markdown,
        _ => FileKind::Other,
    }
}

pub fn entry_for(path: &Path) -> AppResult<FileEntry> {
    let meta = path.metadata()?;
    let mtime_ns = (meta.mtime() as i128) * 1_000_000_000 + i128::from(meta.mtime_nsec());
    Ok(FileEntry {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        kind: if meta.is_dir() {
            FileKind::Dir
        } else {
            classify(path)
        },
        path: path.to_string_lossy().to_string(),
        inode: meta.ino(),
        size: meta.size(),
        mtime_ns: mtime_ns.to_string(),
        is_dir: meta.is_dir(),
    })
}

/// Immediate children of one directory, dotfiles skipped. Sorted folders
/// first, then case-insensitive by name — the default order a canvas lays
/// out before a layout sidecar exists.
pub fn list_dir(dir: &Path) -> AppResult<Vec<FileEntry>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if let Ok(file_entry) = entry_for(&entry.path()) {
            out.push(file_entry);
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Recursive scan of the workspace. Dotfiles (including `.canvas/`) never
/// appear on a canvas and are skipped entirely.
pub fn scan(root: &Path) -> AppResult<Vec<FileEntry>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let Ok(file_entry) = entry_for(&path) else {
                continue;
            };
            if file_entry.is_dir {
                stack.push(path);
            }
            out.push(file_entry);
        }
    }
    Ok(out)
}
