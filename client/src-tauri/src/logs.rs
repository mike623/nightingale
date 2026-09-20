use app_core::LogTail;

/// The end of this run's log, for the in-app viewer. The file belongs to the
/// person running the app and is already redacted at the point of logging, so
/// the command reads it as-is.
#[tauri::command]
pub(crate) fn read_log() -> Result<LogTail, String> {
    app_core::read_log_tail()
}
