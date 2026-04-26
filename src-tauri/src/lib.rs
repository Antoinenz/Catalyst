mod state;
mod worker;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use state::{AppState, DownloadJob, DownloadStatus};

type AppStateRef = Arc<AppState>;

#[tauri::command]
async fn add_download(
    url: String,
    app: AppHandle,
    state: State<'_, AppStateRef>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let job = DownloadJob {
        id: id.clone(),
        url: url.clone(),
        title: None,
        status: DownloadStatus::Queued,
        progress: 0.0,
        speed: None,
        eta: None,
        size: None,
    };

    state.jobs.lock().unwrap().push(job.clone());
    let _ = app.emit("download-update", &job);

    let state_arc = state.inner().clone();
    let id_clone = id.clone();
    tauri::async_runtime::spawn(async move {
        worker::run_download(id_clone, url, state_arc, app).await;
    });

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
fn remove_job(id: String, state: State<'_, AppStateRef>) {
    state.jobs.lock().unwrap().retain(|j| j.id != id);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            add_download,
            get_queue,
            cancel_download,
            remove_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Catalyst");
}
