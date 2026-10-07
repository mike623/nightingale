use app_core::{
    clear_models, clear_songs, clear_videos, sweep_orphan_cache, CacheStats, SweepReport,
};

#[tauri::command]
pub(crate) fn calculate_cache_stats() -> CacheStats {
    CacheStats::calculate()
}

#[tauri::command]
pub(crate) fn clear_videos_command() {
    clear_videos();
}

#[tauri::command]
pub(crate) fn clear_models_command() {
    clear_models();
}

#[tauri::command]
pub(crate) fn clear_songs_command() {
    clear_songs();
}

#[tauri::command]
pub(crate) fn sweep_orphan_cache_command() -> Result<SweepReport, String> {
    sweep_orphan_cache()
}

#[tauri::command]
pub(crate) fn clear_all() {
    clear_models();
    clear_videos();
    clear_songs();
}
