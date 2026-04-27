use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_output_dir() -> String {
    dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}
fn default_format_type() -> String { "mp4".to_string() }
fn default_quality()      -> String { "best".to_string() }
fn default_concurrent()   -> usize  { 3 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    /// Container / codec preference: "mp4" | "best" | "mp3" | "m4a"
    #[serde(default = "default_format_type")]
    pub default_format_type: String,
    /// Resolution cap: "best" | "2160p" | "1080p" | "720p" | "480p" | "360p"
    #[serde(default = "default_quality")]
    pub default_quality: String,
    #[serde(default = "default_concurrent")]
    pub max_concurrent: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            output_dir:          default_output_dir(),
            default_format_type: default_format_type(),
            default_quality:     default_quality(),
            max_concurrent:      default_concurrent(),
        }
    }
}

pub fn is_audio_format(format_type: &str) -> bool {
    matches!(format_type, "mp3" | "m4a")
}

/// Builds the yt-dlp arguments for the given format_type × quality combination.
pub fn format_args(format_type: &str, quality: &str) -> Vec<String> {
    // Audio — quality param is ignored
    if format_type == "mp3" {
        return vec![
            "--extract-audio".into(),
            "--audio-format".into(), "mp3".into(),
            "--audio-quality".into(), "0".into(),
        ];
    }
    if format_type == "m4a" {
        return vec![
            "--extract-audio".into(),
            "--audio-format".into(), "m4a".into(),
            "--audio-quality".into(), "0".into(),
        ];
    }

    // Height filter string for resolution cap
    let h = match quality {
        "2160p" => "[height<=2160]",
        "1080p" => "[height<=1080]",
        "720p"  => "[height<=720]",
        "480p"  => "[height<=480]",
        "360p"  => "[height<=360]",
        _       => "",  // "best" — no cap
    };

    let fmt = match format_type {
        // Explicit MP4 + H264 + AAC — plays everywhere
        "mp4" => format!(
            "bestvideo{h}[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo{h}[ext=mp4]+bestaudio[ext=m4a]\
             /best{h}[ext=mp4]\
             /bestvideo{h}+bestaudio",
            h = h
        ),
        // Whatever yt-dlp considers best (may be AV1/webm)
        "best" => {
            if h.is_empty() {
                "bestvideo+bestaudio/best".to_string()
            } else {
                format!("bestvideo{h}+bestaudio/best{h}", h = h)
            }
        }
        _ => format!(
            "bestvideo{h}[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo{h}+bestaudio/best",
            h = h
        ),
    };

    vec!["-f".into(), fmt]
}
