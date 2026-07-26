mod commands;
mod error;
mod media;
mod state;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_workspace,
            commands::rescan,
            commands::generate_poster,
            commands::import_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
