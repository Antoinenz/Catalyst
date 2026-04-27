mod browsers;
mod config;
mod db;
mod state;
mod worker;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use state::{AppState, DownloadJob, DownloadStatus};
use config::Config;
use db::{HistoryEntry, HistoryStats};

type AppStateRef = Arc<AppState>;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// ─── helpers ─────────────────────────────────────────────────────────────────

fn config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config_to_disk(app: &AppHandle, cfg: &Config) {
    if let Some(path) = config_path(app) {
        if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
        if let Ok(j) = serde_json::to_string_pretty(cfg) { let _ = std::fs::write(path, j); }
    }
}

fn init_db(app: &AppHandle) -> Option<db::Database> {
    let path = app.path().app_data_dir().ok()?.join("history.db");
    std::fs::create_dir_all(path.parent()?).ok()?;
    db::Database::new(&path).ok()
}

fn enqueue(id: String, url: String, fmt: String, quality: String, state: &AppStateRef, app: AppHandle) {
    let arc = state.clone();
    tauri::async_runtime::spawn(async move {
        worker::run(id, url, fmt, quality, arc, app).await;
    });
}

fn make_job(id: &str, url: &str, fmt: &str, quality: &str) -> DownloadJob {
    DownloadJob {
        id: id.to_string(), url: url.to_string(),
        title: None, thumbnail: None, duration: None, uploader: None,
        format_type: fmt.to_string(), quality: quality.to_string(), actual_quality: None,
        status: DownloadStatus::Fetching,
        progress: 0.0, speed: None, eta: None, size: None, output_path: None,
    }
}

// ─── queue commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn add_download(
    url: String, format_type: Option<String>, quality: Option<String>,
    app: AppHandle, state: State<'_, AppStateRef>,
) -> Result<String, String> {
    let (fmt, qual) = {
        let cfg = state.config.lock().unwrap();
        (format_type.unwrap_or_else(|| cfg.default_format_type.clone()),
         quality.unwrap_or_else(||    cfg.default_quality.clone()))
    };
    let id = uuid::Uuid::new_v4().to_string();
    let job = make_job(&id, &url, &fmt, &qual);
    state.jobs.lock().unwrap().push(job.clone());
    let _ = app.emit("download-update", &job);
    enqueue(id.clone(), url, fmt, qual, state.inner(), app);
    Ok(id)
}

#[tauri::command]
async fn add_downloads_bulk(
    urls: Vec<String>, format_type: Option<String>, quality: Option<String>,
    app: AppHandle, state: State<'_, AppStateRef>,
) -> Result<usize, String> {
    let (fmt, qual) = {
        let cfg = state.config.lock().unwrap();
        (format_type.unwrap_or_else(|| cfg.default_format_type.clone()),
         quality.unwrap_or_else(||    cfg.default_quality.clone()))
    };
    let n = urls.len();
    for url in urls {
        let id = uuid::Uuid::new_v4().to_string();
        let job = make_job(&id, &url, &fmt, &qual);
        state.jobs.lock().unwrap().push(job.clone());
        let _ = app.emit("download-update", &job);
        enqueue(id, url, fmt.clone(), qual.clone(), state.inner(), app.clone());
    }
    Ok(n)
}

#[tauri::command]
fn get_queue(state: State<'_, AppStateRef>) -> Vec<DownloadJob> {
    state.jobs.lock().unwrap().clone()
}

#[tauri::command]
fn cancel_download(id: String, state: State<'_, AppStateRef>, app: AppHandle) -> Result<(), String> {
    if let Some(child) = state.children.lock().unwrap().remove(&id) { let _ = child.kill(); }
    state.update_job(&id, |job| job.status = DownloadStatus::Cancelled);
    if let Some(job) = state.get_job(&id) { let _ = app.emit("download-update", job); }
    Ok(())
}

#[tauri::command]
async fn retry_download(id: String, state: State<'_, AppStateRef>, app: AppHandle) -> Result<(), String> {
    let (url, fmt, qual) = {
        let jobs = state.jobs.lock().unwrap();
        let job = jobs.iter().find(|j| j.id == id).ok_or("Job not found")?;
        (job.url.clone(), job.format_type.clone(), job.quality.clone())
    };
    let new_job = make_job(&id, &url, &fmt, &qual);
    state.update_job(&id, |job| *job = new_job.clone());
    let _ = app.emit("download-update", &new_job);
    enqueue(id, url, fmt, qual, state.inner(), app);
    Ok(())
}

#[tauri::command]
fn remove_job(id: String, state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| j.id != id);
}

#[tauri::command]
fn remove_jobs(ids: Vec<String>, state: State<'_, AppStateRef>) {
    let set: std::collections::HashSet<_> = ids.into_iter().collect();
    state.jobs.lock().unwrap().retain(|j| !set.contains(&j.id));
}

#[tauri::command]
fn clear_completed(state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| {
        !matches!(j.status, DownloadStatus::Finished | DownloadStatus::Failed { .. } | DownloadStatus::Cancelled)
    });
}

// ─── file / url commands ─────────────────────────────────────────────────────

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

// ─── queue pause ─────────────────────────────────────────────────────────────

#[tauri::command]
fn set_queue_paused(paused: bool, state: State<'_, AppStateRef>) {
    *state.queue_paused.lock().unwrap() = paused;
}

#[tauri::command]
fn get_queue_paused(state: State<'_, AppStateRef>) -> bool {
    *state.queue_paused.lock().unwrap()
}

// ─── config commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_config(state: State<'_, AppStateRef>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(new_config: Config, state: State<'_, AppStateRef>, app: AppHandle) -> Result<(), String> {
    save_config_to_disk(&app, &new_config);
    *state.config.lock().unwrap() = new_config;
    Ok(())
}

// ─── history commands ────────────────────────────────────────────────────────

#[tauri::command]
fn get_history(limit: Option<usize>, state: State<'_, AppStateRef>) -> Vec<HistoryEntry> {
    state.db.as_ref().and_then(|db| db.get_all(limit.unwrap_or(1000)).ok()).unwrap_or_default()
}

#[tauri::command]
fn delete_history_entry(id: String, state: State<'_, AppStateRef>) -> Result<(), String> {
    state.db.as_ref().map(|db| db.delete(&id).map_err(|e| e.to_string())).unwrap_or(Ok(()))
}

#[tauri::command]
fn clear_history(state: State<'_, AppStateRef>) -> Result<(), String> {
    state.db.as_ref().map(|db| db.clear().map_err(|e| e.to_string())).unwrap_or(Ok(()))
}

#[tauri::command]
fn get_history_stats(state: State<'_, AppStateRef>) -> HistoryStats {
    state.db.as_ref().and_then(|db| db.get_stats().ok()).unwrap_or_default()
}

// ─── history pause ("stop time") ─────────────────────────────────────────────

#[tauri::command]
fn set_history_pause(until: Option<i64>, state: State<'_, AppStateRef>) {
    *state.history_paused_until.lock().unwrap() = until;
}

#[tauri::command]
fn get_history_pause(state: State<'_, AppStateRef>) -> Option<i64> {
    *state.history_paused_until.lock().unwrap()
}

// ─── browser detection ───────────────────────────────────────────────────────

#[tauri::command]
fn detect_browsers() -> Vec<browsers::DetectedBrowser> {
    browsers::detect()
}

// ─── yt-dlp management ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_ytdlp_version(app: AppHandle) -> Result<String, String> {
    let (mut rx, _) = app.shell().sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(["--version"])
        .spawn()
        .map_err(|e| e.to_string())?;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(b) => return Ok(String::from_utf8_lossy(&b).trim().to_string()),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Err("Could not read version".to_string())
}

#[tauri::command]
async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    let (mut rx, _) = app.shell().sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(["-U"])
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut out = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                out += &String::from_utf8_lossy(&b);
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(out.trim().to_string())
}

#[tauri::command]
fn get_app_version() -> &'static str { APP_VERSION }

// ─── setup ───────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cfg = load_config(app.handle());
            // Background yt-dlp auto-update
            if cfg.auto_update_ytdlp {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = h.shell().sidecar("yt-dlp")
                        .ok().and_then(|s| s.args(["-U"]).spawn().ok());
                });
            }
            let database = init_db(app.handle());
            app.manage(Arc::new(AppState::new(cfg, database)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_download, add_downloads_bulk, get_queue,
            cancel_download, retry_download,
            remove_job, remove_jobs, clear_completed,
            open_folder, open_url, delete_file,
            set_queue_paused, get_queue_paused,
            get_config, save_config,
            get_history, delete_history_entry, clear_history, get_history_stats,
            set_history_pause, get_history_pause,
            detect_browsers,
            get_ytdlp_version, update_ytdlp, get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Catalyst");
}
