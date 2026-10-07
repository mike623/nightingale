use app_core::Song;

#[tauri::command]
pub(crate) fn record_song_play(file_hash: String, sung: bool) -> Result<(), String> {
    app_core::record_song_play(&file_hash, sung)
}

#[tauri::command]
pub(crate) fn pick_next_song(exclude_file_hash: Option<String>) -> Result<Option<Song>, String> {
    app_core::pick_next_song(exclude_file_hash.as_deref())
}
