use app_core::{ImportPreview, ImportReport};

/// True only when the active library is a Folder — Import is hidden otherwise.
#[tauri::command]
pub fn import_available() -> bool {
    app_core::import_available()
}

/// Resolve a YouTube URL to a preview (single video or playlist) without
/// downloading. Runs off-thread so the UI stays responsive.
#[tauri::command]
pub async fn probe_import(url: String) -> Result<ImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::probe_import(&url))
        .await
        .map_err(|e| e.to_string())?
}

/// Download the previewed entries into the watched folder and trigger a rescan.
/// Long-running (a playlist downloads many videos); runs off-thread.
#[tauri::command]
pub async fn run_import(preview: ImportPreview) -> Result<ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::run_import(&preview))
        .await
        .map_err(|e| e.to_string())?
}
