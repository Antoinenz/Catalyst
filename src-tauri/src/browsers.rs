use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct BrowserProfile {
    pub id:   String, // used directly in yt-dlp --cookies-from-browser BROWSER:PROFILE
    pub name: String, // display name
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedBrowser {
    pub id:       String,
    pub name:     String,
    pub profiles: Vec<BrowserProfile>,
}

// ─── chromium-based ──────────────────────────────────────────────────────────

fn chromium_profiles(user_data: &PathBuf) -> Vec<BrowserProfile> {
    let Ok(entries) = std::fs::read_dir(user_data) else { return vec![] };
    let mut profiles: Vec<BrowserProfile> = entries
        .flatten()
        .filter_map(|e| {
            let dir_name = e.file_name().to_string_lossy().to_string();
            if dir_name != "Default" && !dir_name.starts_with("Profile ") {
                return None;
            }
            let display = {
                let prefs = e.path().join("Preferences");
                std::fs::read_to_string(prefs).ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v["profile"]["name"].as_str().map(str::to_string))
                    .unwrap_or_else(|| dir_name.clone())
            };
            Some(BrowserProfile { id: dir_name, name: display })
        })
        .collect();
    profiles.sort_by(|a, b| {
        if a.id == "Default" { std::cmp::Ordering::Less }
        else if b.id == "Default" { std::cmp::Ordering::Greater }
        else { a.id.cmp(&b.id) }
    });
    profiles
}

// ─── firefox ─────────────────────────────────────────────────────────────────

fn firefox_profiles(ff_dir: &PathBuf) -> Vec<BrowserProfile> {
    let ini = match std::fs::read_to_string(ff_dir.join("profiles.ini")) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut profiles = Vec::new();
    let mut name: Option<String> = None;
    let mut path: Option<String> = None;
    let mut relative = true;

    let flush = |name: &mut Option<String>, path: &mut Option<String>, rel: bool, ff: &PathBuf, v: &mut Vec<BrowserProfile>| {
        if let (Some(n), Some(p)) = (name.take(), path.take()) {
            let abs = if rel { ff.join(&p) } else { PathBuf::from(&p) };
            v.push(BrowserProfile { id: abs.to_string_lossy().to_string(), name: n });
        }
    };

    for line in ini.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            flush(&mut name, &mut path, relative, ff_dir, &mut profiles);
            relative = true;
        } else if let Some(v) = line.strip_prefix("Name=") {
            name = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("Path=") {
            path = Some(v.replace('/', std::path::MAIN_SEPARATOR_STR));
        } else if line == "IsRelative=0" {
            relative = false;
        }
    }
    flush(&mut name, &mut path, relative, ff_dir, &mut profiles);
    profiles
}

// ─── platform browser paths ──────────────────────────────────────────────────

pub fn detect() -> Vec<DetectedBrowser> {
    let local   = dirs::data_local_dir().unwrap_or_default();
    let roaming = dirs::data_dir().unwrap_or_default();

    #[cfg(target_os = "windows")]
    let chromium_paths: &[(&str, &str, PathBuf)] = &[
        ("chrome",   "Google Chrome",  local.join("Google/Chrome/User Data")),
        ("edge",     "Microsoft Edge", local.join("Microsoft/Edge/User Data")),
        ("brave",    "Brave",          local.join("BraveSoftware/Brave-Browser/User Data")),
        ("opera",    "Opera",          roaming.join("Opera Software/Opera Stable")),
        ("vivaldi",  "Vivaldi",        local.join("Vivaldi/User Data")),
        ("chromium", "Chromium",       local.join("Chromium/User Data")),
    ];

    #[cfg(target_os = "macos")]
    let chromium_paths: &[(&str, &str, PathBuf)] = &[
        ("chrome",   "Google Chrome",  roaming.join("Google/Chrome")),
        ("edge",     "Microsoft Edge", roaming.join("Microsoft Edge")),
        ("brave",    "Brave",          roaming.join("BraveSoftware/Brave-Browser")),
        ("opera",    "Opera",          roaming.join("com.operasoftware.Opera")),
        ("vivaldi",  "Vivaldi",        roaming.join("Vivaldi")),
        ("chromium", "Chromium",       roaming.join("Chromium")),
    ];

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let chromium_paths: &[(&str, &str, PathBuf)] = &[
        ("chrome",   "Google Chrome", local.join("google-chrome")),
        ("chromium", "Chromium",      local.join("chromium")),
        ("brave",    "Brave",         local.join("BraveSoftware/Brave-Browser")),
    ];

    #[cfg(not(target_os = "linux"))]
    let ff_dir = roaming.join("Mozilla/Firefox");
    #[cfg(target_os = "linux")]
    let ff_dir = dirs::home_dir().unwrap_or_default().join(".mozilla/firefox");

    let mut result: Vec<DetectedBrowser> = chromium_paths
        .iter()
        .filter(|(_, _, path)| path.exists())
        .map(|(id, name, path)| {
            let profiles = chromium_profiles(path);
            DetectedBrowser { id: id.to_string(), name: name.to_string(), profiles }
        })
        .filter(|b| !b.profiles.is_empty())
        .collect();

    if ff_dir.exists() {
        let profiles = firefox_profiles(&ff_dir);
        if !profiles.is_empty() {
            result.push(DetectedBrowser { id: "firefox".into(), name: "Firefox".into(), profiles });
        }
    }

    result
}
