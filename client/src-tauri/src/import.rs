use app_core::ImportPreview;
use tauri::{AppHandle, Emitter};

/// True only when the active library is a Folder — Import is hidden otherwise.
#[tauri::command]
pub(crate) fn import_available() -> bool {
    app_core::import_available()
}

/// YouTube video ids already imported into the active folder library. The
/// preview uses this to flag/uncheck entries that would just be re-downloads.
#[tauri::command]
pub(crate) fn imported_video_ids() -> Vec<String> {
    app_core::imported_video_ids()
}

/// Resolve a YouTube URL to a preview (single video or playlist) without
/// downloading. Runs off-thread so the UI stays responsive.
#[tauri::command]
pub(crate) async fn probe_import(url: String) -> Result<ImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::probe_import(&url))
        .await
        .map_err(|e| e.to_string())?
}

/// Kick off a download of the previewed entries in the background and return
/// immediately. Progress streams over the `import-progress` event; the final
/// `ImportReport` arrives on `import-done`, or an error on `import-error`.
#[tauri::command]
pub(crate) fn start_import(app: AppHandle, preview: ImportPreview) {
    std::thread::spawn(move || {
        let app_for_progress = app.clone();
        let result = app_core::run_import(&preview, move |progress| {
            let _ = app_for_progress.emit("import-progress", progress);
        });
        match result {
            Ok(report) => {
                let _ = app.emit("import-done", report);
            }
            Err(e) => {
                let _ = app.emit("import-error", e);
            }
        }
    });
}
