use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri_plugin_shell::process::CommandChild;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Finished,
    Failed { message: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub status: DownloadStatus,
    pub progress: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub size: Option<String>,
}

#[derive(Default)]
pub struct AppState {
    pub jobs: Mutex<Vec<DownloadJob>>,
    pub children: Mutex<HashMap<String, CommandChild>>,
}

impl AppState {
    pub fn update_job<F: FnOnce(&mut DownloadJob)>(&self, id: &str, f: F) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
                f(job);
            }
        }
    }

    pub fn get_job(&self, id: &str) -> Option<DownloadJob> {
        self.jobs.lock().ok()?.iter().find(|j| j.id == id).cloned()
    }
}
