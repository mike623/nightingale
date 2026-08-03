use app_core::{
    apply_timed_lyrics as core_apply_timed_lyrics, load_lyrics_file, provide_lrc as core_provide_lrc,
    save_lyrics_and_realign, search_lrclib_for_hash, search_lrclib_terms as core_search_lrclib_terms,
    LrclibCandidate, LyricsFile,
};

#[tauri::command]
pub fn load_lyrics(file_hash: String) -> Option<LyricsFile> {
    load_lyrics_file(&file_hash)
}

#[tauri::command]
pub async fn search_lrclib_lyrics(file_hash: String) -> Vec<LrclibCandidate> {
    tauri::async_runtime::spawn_blocking(move || search_lrclib_for_hash(&file_hash))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn search_lrclib_terms(track: String, artist: String) -> Vec<LrclibCandidate> {
    tauri::async_runtime::spawn_blocking(move || core_search_lrclib_terms(&track, &artist))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_lyrics(file_hash: String, lines: Vec<String>) -> Result<(), String> {
    save_lyrics_and_realign(&file_hash, lines)
}

#[tauri::command]
pub fn provide_lrc(file_hash: String, lrc_text: String, separate_stems: bool) -> Result<(), String> {
    core_provide_lrc(&file_hash, &lrc_text, separate_stems)
}

#[tauri::command]
pub fn apply_timed_lyrics(file_hash: String, lrc_text: String) -> Result<(), String> {
    core_apply_timed_lyrics(&file_hash, &lrc_text)
}
