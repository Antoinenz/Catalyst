mod config;
mod state;
mod worker;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use state::{AppState, DownloadJob, DownloadStatus};
use config::Config;

type AppStateRef = Arc<AppState>;

// ─── helpers ────────────────────────────────────────────────────────────────

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
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(cfg) {
            let _ = std::fs::write(path, json);
        }
    }
}

fn spawn_pipeline(
    id: String, url: String, fmt: String, quality: String,
    state: &AppStateRef, app: AppHandle,
) {
    let arc = state.clone();
    tauri::async_runtime::spawn(async move {
        worker::run(id, url, fmt, quality, arc, app).await;
    });
}

// ─── commands ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn add_download(
    url: String,
    format_type: Option<String>,
    quality: Option<String>,
    app: AppHandle,
    state: State<'_, AppStateRef>,
) -> Result<String, String> {
    let (fmt, qual) = {
        let cfg = state.config.lock().unwrap();
        (
            format_type.unwrap_or_else(|| cfg.default_format_type.clone()),
            quality.unwrap_or_else(||     cfg.default_quality.clone()),
        )
    };
    let id = uuid::Uuid::new_v4().to_string();
    let job = DownloadJob {
        id: id.clone(), url: url.clone(),
        title: None, thumbnail: None, duration: None, uploader: None,
        format_type: fmt.clone(), quality: qual.clone(),
        status: DownloadStatus::Fetching,
        progress: 0.0, speed: None, eta: None, size: None, output_path: None,
    };
    state.jobs.lock().unwrap().push(job.clone());
    let _ = app.emit("download-update", &job);
    spawn_pipeline(id.clone(), url, fmt, qual, state.inner(), app);
    Ok(id)
}

#[tauri::command]
fn get_queue(state: State<'_, AppStateRef>) -> Vec<DownloadJob> {
    state.jobs.lock().unwrap().clone()
}

#[tauri::command]
fn cancel_download(id: String, state: State<'_, AppStateRef>, app: AppHandle) -> Result<(), String> {
    if let Some(child) = state.children.lock().unwrap().remove(&id) {
        let _ = child.kill();
    }
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
    state.update_job(&id, |job| {
        job.status = DownloadStatus::Fetching;
        job.progress = 0.0;
        job.speed = None; job.eta = None; job.output_path = None;
        job.title = None; job.thumbnail = None; job.duration = None; job.uploader = None;
    });
    if let Some(job) = state.get_job(&id) { let _ = app.emit("download-update", job); }
    spawn_pipeline(id, url, fmt, qual, state.inner(), app);
    Ok(())
}

#[tauri::command]
fn remove_job(id: String, state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| j.id != id);
}

#[tauri::command]
fn remove_jobs(ids: Vec<String>, state: State<'_, AppStateRef>) {
    let set: std::collections::HashSet<String> = ids.into_iter().collect();
    state.jobs.lock().unwrap().retain(|j| !set.contains(&j.id));
}

#[tauri::command]
fn clear_completed(state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| {
        !matches!(j.status, DownloadStatus::Finished | DownloadStatus::Failed { .. } | DownloadStatus::Cancelled)
    });
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    open::that(dir).map_err(|e| e.to_string())
}

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

// ─── setup ──────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cfg = load_config(app.handle());
            app.manage(Arc::new(AppState::new(cfg)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_download, get_queue,
            cancel_download, retry_download,
            remove_job, remove_jobs, clear_completed,
            open_folder, get_config, save_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Catalyst");
}
