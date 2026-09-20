//! The desktop log file: where it lives, and how a reader gets its tail.
//!
//! Only the tail is ever read. The file is rewritten on every launch, but a
//! long session can still grow it past what any reader wants in memory, and
//! the useful part of a diagnosis is always the end.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde::Serialize;
use ts_rs::TS;

use crate::cache::default_nightingale_dir;

/// How much of the end of the log a read returns.
const TAIL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LogTail {
    /// Where the file is, so a reader can open it outside the app.
    pub path: String,
    pub text: String,
    /// True when the file was longer than the tail that was read.
    pub truncated: bool,
}

pub fn log_path() -> PathBuf {
    default_nightingale_dir().join("nightingale.log")
}

/// The end of the log as text. A file that does not exist yet is not an
/// error: nothing has been logged, which is itself the answer.
pub fn read_log_tail() -> Result<LogTail, String> {
    let path = log_path();
    let display = path.display().to_string();

    if !path.exists() {
        return Ok(LogTail {
            path: display,
            text: String::new(),
            truncated: false,
        });
    }

    let mut file = File::open(&path).map_err(|error| format!("could not open the log: {error}"))?;
    let len = file
        .metadata()
        .map_err(|error| format!("could not measure the log: {error}"))?
        .len();
    let truncated = len > TAIL_BYTES;

    if truncated {
        file.seek(SeekFrom::End(-(TAIL_BYTES as i64)))
            .map_err(|error| format!("could not seek the log: {error}"))?;
    }

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("could not read the log: {error}"))?;

    // A tail starts mid-line, and half a line reads as a different event than
    // the one actually logged.
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let text = if truncated {
        match text.find('\n') {
            Some(first) => text[first + 1..].to_string(),
            None => text,
        }
    } else {
        text
    };

    Ok(LogTail {
        path: display,
        text,
        truncated,
    })
}
