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

fn spawn_download(id: String, url: String, format: String, state: &AppStateRef, app: AppHandle) {
    let state_arc = state.clone();
    tauri::async_runtime::spawn(async move {
        worker::run_download(id, url, format, state_arc, app).await;
    });
}

// ─── commands ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn add_download(
    url: String,
    format: Option<String>,
    app: AppHandle,
    state: State<'_, AppStateRef>,
) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| {
        state.config.lock().unwrap().default_format.clone()
    });
    let id = uuid::Uuid::new_v4().to_string();
    let job = DownloadJob {
        id: id.clone(),
        url: url.clone(),
        title: None,
        format: fmt.clone(),
        status: DownloadStatus::Queued,
        progress: 0.0,
        speed: None,
        eta: None,
        size: None,
        output_path: None,
    };
    state.jobs.lock().unwrap().push(job.clone());
    let _ = app.emit("download-update", &job);
    spawn_download(id.clone(), url, fmt, state.inner(), app);
    Ok(id)
}

#[tauri::command]
fn get_queue(state: State<'_, AppStateRef>) -> Vec<DownloadJob> {
    state.jobs.lock().unwrap().clone()
}

#[tauri::command]
fn cancel_download(
    id: String,
    state: State<'_, AppStateRef>,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(child) = state.children.lock().unwrap().remove(&id) {
        let _ = child.kill();
    }
    state.update_job(&id, |job| job.status = DownloadStatus::Cancelled);
    if let Some(job) = state.get_job(&id) {
        let _ = app.emit("download-update", job);
    }
    Ok(())
}

#[tauri::command]
async fn retry_download(
    id: String,
    state: State<'_, AppStateRef>,
    app: AppHandle,
) -> Result<(), String> {
    let (url, fmt) = {
        let jobs = state.jobs.lock().unwrap();
        let job = jobs.iter().find(|j| j.id == id).ok_or("Job not found")?;
        (job.url.clone(), job.format.clone())
    };
    state.update_job(&id, |job| {
        job.status = DownloadStatus::Queued;
        job.progress = 0.0;
        job.speed = None;
        job.eta = None;
        job.output_path = None;
    });
    if let Some(job) = state.get_job(&id) {
        let _ = app.emit("download-update", job);
    }
    spawn_download(id, url, fmt, state.inner(), app);
    Ok(())
}

#[tauri::command]
fn remove_job(id: String, state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| j.id != id);
}

#[tauri::command]
fn clear_completed(state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| {
        !matches!(j.status, DownloadStatus::Finished | DownloadStatus::Failed { .. } | DownloadStatus::Cancelled)
    });
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    // Open the folder that contains the file (or the path itself if it's a dir)
    let p = std::path::Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    open::that(dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config(state: State<'_, AppStateRef>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(
    new_config: Config,
    state: State<'_, AppStateRef>,
    app: AppHandle,
) -> Result<(), String> {
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
            add_download,
            get_queue,
            cancel_download,
            retry_download,
            remove_job,
            clear_completed,
            open_folder,
            get_config,
            save_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Catalyst");
}
