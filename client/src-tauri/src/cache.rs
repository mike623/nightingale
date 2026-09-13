use app_core::{
    clear_models, clear_songs, clear_videos, sweep_orphan_cache, CacheStats, SweepReport,
};

#[tauri::command]
pub fn calculate_cache_stats() -> CacheStats {
    CacheStats::calculate()
}

#[tauri::command]
pub fn clear_videos_command() {
    clear_videos();
}

#[tauri::command]
pub fn clear_models_command() {
    clear_models();
}

#[tauri::command]
pub fn clear_songs_command() {
    clear_songs();
}

#[tauri::command]
pub fn sweep_orphan_cache_command() -> Result<SweepReport, String> {
    sweep_orphan_cache()
}

#[tauri::command]
pub fn clear_all() {
    clear_models();
    clear_videos();
    clear_songs();
}
