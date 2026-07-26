use serde::Serialize;

/// Error surface for every Tauri command. Serializes as `{ code, message }`
/// so the frontend can branch on `code` without parsing strings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NoWorkspace,
    NotADirectory,
    PathEscape,
    Io,
    Watcher,
    Ffmpeg,
    BadFilename,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn no_workspace() -> Self {
        Self::new(ErrorCode::NoWorkspace, "no workspace selected")
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::new(ErrorCode::Io, e.to_string())
    }
}

impl From<notify::Error> for AppError {
    fn from(e: notify::Error) -> Self {
        Self::new(ErrorCode::Watcher, e.to_string())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

pub type AppResult<T> = Result<T, AppError>;
