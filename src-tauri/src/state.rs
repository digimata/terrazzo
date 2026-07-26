use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

/// The active workspace. The watcher lives here so its lifetime is tied to
/// the workspace: replacing the workspace drops the old watcher.
pub struct Workspace {
    pub root: PathBuf,
    pub _watcher: notify::RecommendedWatcher,
}

#[derive(Default)]
pub struct AppState(pub Mutex<Option<Workspace>>);

impl AppState {
    pub fn root(&self) -> AppResult<PathBuf> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .map(|ws| ws.root.clone())
            .ok_or_else(AppError::no_workspace)
    }
}
