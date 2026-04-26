use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub output_dir: String,
    pub default_format: String,
    pub max_concurrent: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            output_dir: dirs::download_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string(),
            default_format: "best_mp4".to_string(),
            max_concurrent: 3,
        }
    }
}

/// Maps a format preset id to the yt-dlp arguments it requires.
/// Returns (format_flag_args, extra_args) — kept separate because
/// audio extraction uses different flags entirely.
pub fn format_args(format: &str) -> Vec<String> {
    match format {
        // Explicit MP4 + H264 — what most people actually want
        "best_mp4" => vec![
            "-f".into(),
            "bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo[ext=mp4]+bestaudio[ext=m4a]\
             /best[ext=mp4]\
             /bestvideo+bestaudio"
                .into(),
        ],
        // Whatever yt-dlp considers best (may be AV1/webm)
        "best" => vec!["-f".into(), "bestvideo+bestaudio/best".into()],
        // Capped resolutions, prefer H264 mp4 but fall back gracefully
        "1080p" => vec![
            "-f".into(),
            "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo[height<=1080]+bestaudio\
             /best[height<=1080]"
                .into(),
        ],
        "720p" => vec![
            "-f".into(),
            "bestvideo[height<=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo[height<=720]+bestaudio\
             /best[height<=720]"
                .into(),
        ],
        "480p" => vec![
            "-f".into(),
            "bestvideo[height<=480][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo[height<=480]+bestaudio\
             /best[height<=480]"
                .into(),
        ],
        // Audio extraction
        "mp3" => vec![
            "--extract-audio".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            "0".into(),
        ],
        "m4a" => vec![
            "--extract-audio".into(),
            "--audio-format".into(),
            "m4a".into(),
            "--audio-quality".into(),
            "0".into(),
        ],
        // Fallback — same as best_mp4
        _ => format_args("best_mp4"),
    }
}
