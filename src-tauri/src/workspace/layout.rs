//! Per-directory layout sidecar: `<dir>/.canvas/layout.json` (PRD §3.7).
//!
//! Items are keyed by durable UUIDv7, not filename — identity survives
//! renames and restarts. `lastSeen` is the reconciliation fingerprint, a
//! hint, never truth. The tldraw store is a projection of listing + sidecar;
//! shape changes project back here through typed deltas (v0 plan §4.4).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::workspace::scan::{self, FileEntry};
use crate::workspace::sidecar;

const LAYOUT_FILE: &str = "layout.json";

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutFile {
    pub schema_version: u32,
    pub items: BTreeMap<String, LayoutItem>,
}

impl Default for LayoutFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            items: BTreeMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutItem {
    /// Path relative to the owning directory.
    pub path: String,
    pub last_seen: LastSeen,
    /// Absent until the frontend first places the item.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<Frame>,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub z_index: i64,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LastSeen {
    pub device: u64,
    pub inode: u64,
    pub mtime_ns: String,
    pub size: u64,
}

impl LastSeen {
    fn of(entry: &FileEntry) -> Self {
        Self {
            device: entry.device,
            inode: entry.inode,
            mtime_ns: entry.mtime_ns.clone(),
            size: entry.size,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One reconciled canvas item on the wire. Mirrored by `CanvasItem` in
/// `src/app/ipc/types.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CanvasItem {
    pub id: String,
    /// For a tombstone this is synthesized from the layout entry's last-known
    /// state — the file itself is gone.
    pub entry: FileEntry,
    pub frame: Option<Frame>,
    pub rotation: f64,
    pub z_index: i64,
    /// PR-022 tombstone: the layout entry no longer resolves to a file.
    pub missing: bool,
}

/// A frontend layout mutation for one item. Mirrored by `LayoutDelta` in
/// `src/app/ipc/types.ts`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDelta {
    pub id: String,
    pub frame: Frame,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub z_index: i64,
}

fn layout_path(dir: &Path) -> std::path::PathBuf {
    dir.join(sidecar::CANVAS_DIR).join(LAYOUT_FILE)
}

fn read(dir: &Path) -> AppResult<LayoutFile> {
    let file = layout_path(dir);
    if !file.exists() {
        return Ok(LayoutFile::default());
    }
    let raw = fs::read_to_string(&file)?;
    serde_json::from_str(&raw).map_err(|e| {
        AppError::new(
            ErrorCode::Io,
            format!("corrupt layout.json at {}: {e}", file.display()),
        )
    })
}

fn write(dir: &Path, layout: &LayoutFile) -> AppResult<()> {
    let canvas_dir = dir.join(sidecar::CANVAS_DIR);
    fs::create_dir_all(&canvas_dir)?;
    sidecar::write_atomic(
        &layout_path(dir),
        &serde_json::to_vec_pretty(layout).unwrap(),
    )
}

/// Combine the directory listing with `layout.json` (PR-016 reconciliation
/// order):
///
/// 1. Match relative path (also catches atomic-save editors; refresh
///    `lastSeen` after any match).
/// 2. If the old path is gone, match a unique `(device, inode)`.
/// 3. Confirm with mtime and size — inodes get recycled.
/// 4. On match, point the existing UUID at the new path.
/// 5. If ambiguous, keep the old item (tombstone) and mint a new UUID.
///
/// Unmatched layout entries stay in the file as tombstones but are not
/// returned; tombstone rendering is M3 (PR-022).
pub fn open_directory(dir: &Path) -> AppResult<Vec<CanvasItem>> {
    let entries = scan::list_dir(dir)?;
    let mut layout = read(dir)?;
    let before = layout.clone();

    // Pass 1: path matches.
    let mut matched: BTreeMap<String, FileEntry> = BTreeMap::new(); // uuid → entry
    let mut unmatched_entries: Vec<FileEntry> = Vec::new();
    let mut by_path: BTreeMap<String, String> = BTreeMap::new(); // rel path → uuid
    for (id, item) in &layout.items {
        by_path.insert(item.path.clone(), id.clone());
    }
    for entry in entries {
        match by_path.get(&entry.name) {
            Some(id) => {
                matched.insert(id.clone(), entry);
            }
            None => unmatched_entries.push(entry),
        }
    }

    // Pass 2: identity rescue by unique (device, inode), confirmed by
    // mtime + size, among layout items whose path did not resolve.
    for entry in unmatched_entries {
        let candidates: Vec<String> = layout
            .items
            .iter()
            .filter(|(id, item)| {
                !matched.contains_key(*id)
                    && item.last_seen.device == entry.device
                    && item.last_seen.inode == entry.inode
            })
            .map(|(id, _)| id.clone())
            .collect();
        let rescued = match candidates.as_slice() {
            [id] => {
                let seen = &layout.items[id].last_seen;
                (seen.mtime_ns == entry.mtime_ns && seen.size == entry.size)
                    .then(|| id.clone())
            }
            _ => None,
        };
        match rescued {
            Some(id) => {
                matched.insert(id, entry);
            }
            None => {
                let id = Uuid::now_v7().to_string();
                layout.items.insert(
                    id.clone(),
                    LayoutItem {
                        path: entry.name.clone(),
                        last_seen: LastSeen::of(&entry),
                        frame: None,
                        rotation: 0.0,
                        z_index: 0,
                    },
                );
                matched.insert(id, entry);
            }
        }
    }

    // Refresh path + lastSeen on every match.
    for (id, entry) in &matched {
        let item = layout.items.get_mut(id).unwrap();
        item.path = entry.name.clone();
        item.last_seen = LastSeen::of(entry);
    }

    if layout != before {
        write(dir, &layout)?;
    }

    // Unmatched layout entries are tombstones (PR-022): rendered from their
    // last-known state, never silently omitted. They resolve back to live
    // items automatically when the file returns (pass 1/2 rescue).
    let tombstones: Vec<CanvasItem> = layout
        .items
        .iter()
        .filter(|(id, _)| !matched.contains_key(*id))
        .map(|(id, item)| {
            let path = dir.join(&item.path);
            CanvasItem {
                id: id.clone(),
                entry: FileEntry {
                    name: item.path.clone(),
                    kind: scan::classify(&path),
                    path: path.to_string_lossy().to_string(),
                    device: item.last_seen.device,
                    inode: item.last_seen.inode,
                    size: item.last_seen.size,
                    mtime_ns: item.last_seen.mtime_ns.clone(),
                    is_dir: false,
                },
                frame: item.frame.clone(),
                rotation: item.rotation,
                z_index: item.z_index,
                missing: true,
            }
        })
        .collect();

    let mut out: Vec<CanvasItem> = matched
        .into_iter()
        .map(|(id, entry)| {
            let item = &layout.items[&id];
            CanvasItem {
                id,
                entry,
                frame: item.frame.clone(),
                rotation: item.rotation,
                z_index: item.z_index,
                missing: false,
            }
        })
        .chain(tombstones)
        .collect();
    out.sort_by(|a, b| a.z_index.cmp(&b.z_index).then(a.id.cmp(&b.id)));
    Ok(out)
}

/// Move items to the system Trash (v0 §4.5): confirm each UUID still
/// resolves, trash the file or directory, and drop its layout entry only
/// after Trash succeeds. On partial failure the successful removals are
/// still persisted before the first error propagates. The watcher's remove
/// event drives the frontend reconcile.
pub fn trash_items(dir: &Path, ids: &[String]) -> AppResult<()> {
    let mut layout = read(dir)?;
    let mut first_err: Option<AppError> = None;
    let mut changed = false;
    for id in ids {
        let Some(item) = layout.items.get(id) else {
            first_err.get_or_insert_with(|| {
                AppError::new(ErrorCode::Io, format!("trash for unknown item {id}"))
            });
            continue;
        };
        let target = dir.join(&item.path);
        // Tombstone dismissal: the file is already gone, so "trash" degrades
        // to dropping the record. symlink_metadata so a broken symlink still
        // counts as present and goes through the real Trash.
        if target.symlink_metadata().is_err() {
            layout.items.remove(id);
            changed = true;
            continue;
        }
        if let Err(e) = trash::delete(&target) {
            first_err.get_or_insert_with(|| {
                AppError::new(
                    ErrorCode::Io,
                    format!("trash failed for {}: {e}", target.display()),
                )
            });
            continue;
        }
        layout.items.remove(id);
        changed = true;
    }
    if changed {
        write(dir, &layout)?;
    }
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Apply frontend deltas and persist atomically. Unknown IDs are rejected —
/// the frontend's projection is stale and should re-open the directory.
pub fn apply_deltas(dir: &Path, deltas: &[LayoutDelta]) -> AppResult<()> {
    let mut layout = read(dir)?;
    for delta in deltas {
        let item = layout.items.get_mut(&delta.id).ok_or_else(|| {
            AppError::new(
                ErrorCode::Io,
                format!("layout delta for unknown item {}", delta.id),
            )
        })?;
        item.frame = Some(delta.frame.clone());
        item.rotation = delta.rotation;
        item.z_index = delta.z_index;
    }
    write(dir, &layout)
}
