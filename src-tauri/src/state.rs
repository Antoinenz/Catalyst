use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tauri_plugin_shell::process::CommandChild;
use crate::config::Config;

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
    pub format: String,
    pub status: DownloadStatus,
    pub progress: f32,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub size: Option<String>,
    pub output_path: Option<String>,
}

pub struct AppState {
    pub jobs: Mutex<Vec<DownloadJob>>,
    pub children: Mutex<HashMap<String, CommandChild>>,
    pub config: Mutex<Config>,
    pub semaphore: Arc<Semaphore>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let permits = config.max_concurrent;
        Self {
            jobs: Mutex::new(Vec::new()),
            children: Mutex::new(HashMap::new()),
            semaphore: Arc::new(Semaphore::new(permits)),
            config: Mutex::new(config),
        }
    }

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
