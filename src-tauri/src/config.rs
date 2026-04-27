use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_output_dir() -> String {
    dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")).to_string_lossy().to_string()
}
fn default_format_type()  -> String { "mp4".to_string() }
fn default_quality()      -> String { "best".to_string() }
fn default_concurrent()   -> usize  { 3 }
fn default_true()         -> bool   { true }

// ─── cookie source ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(tag = "type")]
pub enum CookieSource {
    #[default]
    None,
    Browser { browser: String, profile: String },
    File    { path: String },
}

impl CookieSource {
    /// Returns extra yt-dlp args for cookie auth, if any.
    pub fn to_args(&self) -> Vec<String> {
        match self {
            Self::None => vec![],
            Self::Browser { browser, profile } => vec![
                "--cookies-from-browser".into(),
                format!("{}:{}", browser, profile),
            ],
            Self::File { path } => vec!["--cookies".into(), path.clone()],
        }
    }
}

// ─── config ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    #[serde(default = "default_format_type")]
    pub default_format_type: String,
    #[serde(default = "default_quality")]
    pub default_quality: String,
    #[serde(default = "default_concurrent")]
    pub max_concurrent: usize,
    #[serde(default)]
    pub cookie_source: CookieSource,
    /// Silently run yt-dlp -U on startup
    #[serde(default = "default_true")]
    pub auto_update_ytdlp: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            output_dir:          default_output_dir(),
            default_format_type: default_format_type(),
            default_quality:     default_quality(),
            max_concurrent:      default_concurrent(),
            cookie_source:       CookieSource::None,
            auto_update_ytdlp:   true,
        }
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

pub fn is_audio_format(format_type: &str) -> bool {
    matches!(format_type, "mp3" | "m4a")
}

pub fn format_args(format_type: &str, quality: &str) -> Vec<String> {
    if format_type == "mp3" {
        return vec!["--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into()];
    }
    if format_type == "m4a" {
        return vec!["--extract-audio".into(), "--audio-format".into(), "m4a".into(), "--audio-quality".into(), "0".into()];
    }
    let h = match quality {
        "2160p" => "[height<=2160]",
        "1080p" => "[height<=1080]",
        "720p"  => "[height<=720]",
        "480p"  => "[height<=480]",
        "360p"  => "[height<=360]",
        _       => "",
    };
    let fmt = match format_type {
        "mp4" => format!(
            "bestvideo{h}[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]\
             /bestvideo{h}[ext=mp4]+bestaudio[ext=m4a]\
             /best{h}[ext=mp4]/bestvideo{h}+bestaudio", h=h),
        "best" => if h.is_empty() { "bestvideo+bestaudio/best".into() }
                  else { format!("bestvideo{h}+bestaudio/best{h}", h=h) },
        _ => format!("bestvideo{h}[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo{h}+bestaudio/best", h=h),
    };
    vec!["-f".into(), fmt]
}
